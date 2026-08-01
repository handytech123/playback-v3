import type { ConfirmedSetManifest } from "../confirmed-set/manifest.js";
import type { PreparedSong, Region } from "../domain/song.js";
import type { PerformanceReadinessReport } from "./performance-readiness.js";

export type LiveBus = "music" | "click" | "cue" | "pad";
export interface BusRoute { readonly firstOutput: number; readonly channels: 1 | 2; }
export type RoutingPlan = Readonly<Record<LiveBus, BusRoute>>;
export interface LiveChannels { readonly music: boolean; readonly click: boolean; readonly cue: boolean; readonly pad: boolean; }
export type MixerChannelKind = "stem" | "click" | "cue" | "pad";
export interface MixerChannelState { readonly id:string;readonly index:number;readonly kind:MixerChannelKind;readonly gain:number;readonly muted:boolean;readonly solo:boolean;readonly iem:boolean; }
export interface LiveMixerState { readonly masterGain:number;readonly channels:readonly MixerChannelState[]; }
export interface PerformanceEffects {
  play(): void; pause(): void; stop(): void; seek(seconds: number): void; panic(): void; announceRecovery(regionId:string,atSeconds:number,repeatAtSeconds:number|null):void; cancelTransition():void; recover():void;
  setBus(bus: LiveBus, enabled: boolean): void;
  setBusGain?(bus:LiveBus,gain:number):void;
  setMixerChannel?(channel:MixerChannelState):void;
  setMasterGain?(gain:number):void;
  selectSong(index: number): Promise<PerformanceReadinessReport | void>;
}
export interface PerformanceSnapshot {
  readonly ready: boolean; readonly readiness: PerformanceReadinessReport; readonly fault: string | null; readonly songIndex: number;
  readonly positionSeconds: number; readonly playing: boolean; readonly currentRegionId: string | null;
  readonly loopRegionId: string | null; readonly channels: LiveChannels; readonly routes: RoutingPlan;
  readonly gains:Readonly<Record<LiveBus,number>>;
  readonly mixer:LiveMixerState;
  readonly panicActive:boolean;readonly recoveryRegionId:string|null;readonly recoveryCueAtSeconds:number|null;readonly recoverAtSeconds:number|null;
}

export const DEFAULT_ROUTES: RoutingPlan = {
  music: { firstOutput: 1, channels: 2 }, click: { firstOutput: 3, channels: 1 },
  cue: { firstOutput: 4, channels: 1 }, pad: { firstOutput: 5, channels: 2 },
};

export class PerformanceSession {
  private current: PerformanceSnapshot;
  constructor(private readonly manifest: ConfirmedSetManifest, private readonly effects: PerformanceEffects, routes: RoutingPlan = DEFAULT_ROUTES, readiness: PerformanceReadinessReport = unverifiedReadiness(), gains:Readonly<Record<LiveBus,number>>={music:1,click:1,cue:1,pad:1}, initialSongIndex=0) {
    if (!manifest.songs.length) throw new Error("Confirmed set is empty");
    if (!manifest.songs[initialSongIndex]) throw new Error("Initial song is outside the confirmed set");
    validateRoutingPlan(routes);
    const initialSong=manifest.songs[initialSongIndex]!;
    this.current={ready:readiness.ready,readiness,fault:null,songIndex:initialSongIndex,positionSeconds:0,playing:false,currentRegionId:initialSong.regions[0]?.id??null,loopRegionId:null,channels:{music:true,click:true,cue:true,pad:false},gains:{...gains},mixer:createMixerState(initialSong),routes,panicActive:false,recoveryRegionId:null,recoveryCueAtSeconds:null,recoverAtSeconds:null};
  }
  get snapshot():PerformanceSnapshot{return structuredClone(this.current);}
  get confirmedSet():ConfirmedSetManifest{return this.manifest;}
  get song():PreparedSong{return this.manifest.songs[this.current.songIndex]!;}
  play():void{this.requireReady();this.effects.play();this.current={...this.current,playing:true};}
  pause():void{this.requireReady();this.effects.pause();this.current={...this.current,playing:false};}
  stop():void{this.effects.stop();this.current={...this.current,playing:false,positionSeconds:0,currentRegionId:this.song.regions[0]?.id??null,loopRegionId:null,panicActive:false,recoveryRegionId:null,recoveryCueAtSeconds:null,recoverAtSeconds:null};}
  panic():void{this.requireReady();if(!this.current.playing)throw new Error("Musical Panic is available while the timeline is playing");this.effects.panic();this.current={...this.current,panicActive:true,recoveryRegionId:null,recoveryCueAtSeconds:null,recoverAtSeconds:null,loopRegionId:null,channels:{...this.current.channels,pad:true}};}
  armRecovery(regionId:string):void{if(!this.current.panicActive)throw new Error("Panic recovery is not active");const region=this.region(regionId);if(!region)throw new Error("Recovery section is not in the armed song");const cue=this.song.liveAssets?.cues.find((item)=>item.targetRegionId===regionId);if(!cue)throw new Error("Recovery section has no prepared announcement");const leadSeconds=Math.max(0,region.startSeconds-cue.atSeconds),regions=this.song.regions;let index=Math.max(0,regions.findIndex((item)=>this.current.positionSeconds>=item.startSeconds&&this.current.positionSeconds<item.endSeconds)),boundary=regions[index]?.endSeconds??this.current.positionSeconds,cueAt=boundary-leadSeconds;if(cueAt<=this.current.positionSeconds+.05&&index+1<regions.length){boundary=regions[++index]!.endSeconds;cueAt=boundary-leadSeconds;}if(cueAt<=this.current.positionSeconds)throw new Error("Not enough song remains to give the full recovery announcement");this.effects.announceRecovery(regionId,cueAt,null);this.current={...this.current,recoveryRegionId:regionId,recoveryCueAtSeconds:cueAt,recoverAtSeconds:boundary};}
  reportFault(reason:string):void{this.current={...this.current,ready:false,playing:false,channels:{...this.current.channels,pad:false},loopRegionId:null,panicActive:false,recoveryRegionId:null,recoveryCueAtSeconds:null,recoverAtSeconds:null,fault:reason};}
  clearFault():void{if(!this.current.readiness.ready)throw new Error("Performance readiness is still blocked");this.current={...this.current,ready:true,fault:null};}
  setReadiness(readiness:PerformanceReadinessReport):void{if(!readiness.ready&&this.current.playing)this.effects.stop();this.current={...this.current,readiness,ready:readiness.ready&&!this.current.fault,playing:readiness.ready?this.current.playing:false};}
  updatePosition(seconds:number):void{if(!Number.isFinite(seconds)||seconds<0)return;if(this.current.recoveryRegionId&&this.current.recoverAtSeconds!==null&&seconds>=this.current.recoverAtSeconds){const target=this.region(this.current.recoveryRegionId)!;this.effects.seek(target.startSeconds);this.effects.recover();const looping=this.current.loopRegionId===target.id;if(looping){const cue=this.cueFor(target.id)!,lead=Math.max(0,target.startSeconds-cue.atSeconds),cueAt=target.endSeconds-lead,repeatAt=cueAt-this.twoBeatSeconds();this.effects.announceRecovery(target.id,cueAt,repeatAt);this.current={...this.current,positionSeconds:target.startSeconds,currentRegionId:target.id,panicActive:false,recoveryCueAtSeconds:cueAt,recoverAtSeconds:target.endSeconds,channels:{...this.current.channels,pad:false}};}else this.current={...this.current,positionSeconds:target.startSeconds,currentRegionId:target.id,panicActive:false,recoveryRegionId:null,recoveryCueAtSeconds:null,recoverAtSeconds:null,channels:{...this.current.channels,pad:false}};return;}this.current={...this.current,positionSeconds:seconds,currentRegionId:regionAt(this.song,seconds)?.id??null};}
  jumpToRegion(regionId:string):void{this.requireReady();if(this.current.panicActive)throw new Error("Choose a Panic recovery target instead of jumping immediately");const region=this.region(regionId);if(!region)throw new Error("Section is not in the armed song");if(this.current.playing){this.armTimedTransition(region.id);return;}this.effects.seek(region.startSeconds);this.current={...this.current,positionSeconds:region.startSeconds,currentRegionId:region.id};}
  nextSection():void{const regions=this.song.regions,index=Math.max(0,regions.findIndex((x)=>x.id===this.current.currentRegionId));this.jumpToRegion(regions[Math.min(index+1,regions.length-1)]!.id);}
  previousSection():void{const regions=this.song.regions,index=Math.max(0,regions.findIndex((x)=>x.id===this.current.currentRegionId));this.jumpToRegion(regions[Math.max(index-1,0)]!.id);}
  toggleLoop(regionId=this.current.currentRegionId):void{if(this.current.panicActive)throw new Error("Loop is unavailable during Panic recovery");if(!regionId||!this.region(regionId))throw new Error("No section is selected for looping");if(this.current.loopRegionId===regionId){const lockAt=(this.current.recoveryCueAtSeconds??0)-this.twoBeatSeconds();if(this.current.playing&&this.current.positionSeconds>=lockAt)throw new Error("Loop is locked because the Repeat cue has already begun");this.effects.cancelTransition();this.current={...this.current,loopRegionId:null,recoveryRegionId:null,recoveryCueAtSeconds:null,recoverAtSeconds:null};return;}this.current={...this.current,loopRegionId:regionId};if(this.current.playing)this.armTimedTransition(regionId,true);}
  repeatOnce(regionId=this.current.currentRegionId):void{this.requireReady();if(this.current.panicActive)throw new Error("Repeat Once is unavailable during Panic recovery");if(!this.current.playing)throw new Error("Repeat Once is available while the timeline is playing");if(!regionId||!this.region(regionId))throw new Error("No section is selected to repeat");if(this.current.loopRegionId)throw new Error("Release Loop before arming Repeat Once");this.armTimedTransition(regionId,true);}
  setBus(bus:LiveBus,enabled:boolean):void{this.requireReady();this.effects.setBus(bus,enabled);this.current={...this.current,channels:{...this.current.channels,[bus]:enabled}};}
  setBusGain(bus:LiveBus,gain:number):void{this.requireReady();if(!Number.isFinite(gain)||gain<0||gain>1.25)throw new Error("Bus gain must be between 0 and 125%");this.effects.setBusGain?.(bus,gain);this.current={...this.current,gains:{...this.current.gains,[bus]:gain}};}
  setMixerChannel(index:number,patch:Partial<Pick<MixerChannelState,"gain"|"muted"|"solo"|"iem">>):void{this.requireReady();const current=this.current.mixer.channels[index];if(!current)throw new Error("Mixer channel is outside the armed song");const next={...current,...patch};if(!Number.isFinite(next.gain)||next.gain<0||next.gain>1.25)throw new Error("Mixer gain must be between 0 and 125%");this.effects.setMixerChannel?.(next);const channels=[...this.current.mixer.channels];channels[index]=next;this.current={...this.current,mixer:{...this.current.mixer,channels}};}
  setMasterGain(gain:number):void{this.requireReady();if(!Number.isFinite(gain)||gain<0||gain>1.25)throw new Error("Master gain must be between 0 and 125%");this.effects.setMasterGain?.(gain);this.current={...this.current,mixer:{...this.current.mixer,masterGain:gain}};}
  async selectSong(index:number):Promise<void>{const song=this.manifest.songs[index];if(!song)throw new Error("Song is outside the confirmed set");this.effects.stop();const readiness=await this.effects.selectSong(index),nextReadiness=readiness??this.current.readiness;this.current={...this.current,readiness:nextReadiness,ready:nextReadiness.ready,songIndex:index,positionSeconds:0,playing:false,currentRegionId:song.regions[0]?.id??null,loopRegionId:null,fault:null,channels:{...this.current.channels,pad:false},mixer:createMixerState(song),panicActive:false,recoveryRegionId:null,recoveryCueAtSeconds:null,recoverAtSeconds:null};}
  async cueNext():Promise<void>{const index=this.current.songIndex+1,song=this.manifest.songs[index];if(!song)throw new Error("There is no next song in the confirmed set");this.effects.stop();const readiness=await this.effects.selectSong(index),nextReadiness=readiness??this.current.readiness;if(!nextReadiness.ready)throw new Error("Next song did not pass performance readiness");this.effects.setBus("pad",true);this.current={...this.current,readiness:nextReadiness,ready:true,songIndex:index,positionSeconds:0,playing:false,currentRegionId:song.regions[0]?.id??null,loopRegionId:null,fault:null,channels:{...this.current.channels,pad:true},mixer:createMixerState(song),panicActive:false,recoveryRegionId:null,recoveryCueAtSeconds:null,recoverAtSeconds:null};}
  private region(id:string|null):Region|undefined{return id?this.song.regions.find((x)=>x.id===id):undefined;}
  private cueFor(regionId:string){return this.song.liveAssets?.cues.find((item)=>item.targetRegionId===regionId);}
  private armTimedTransition(regionId:string,repeatPrefix=false):void{const region=this.region(regionId)!,cue=this.cueFor(regionId);if(!cue)throw new Error("Target section has no prepared announcement");const lead=Math.max(0,region.startSeconds-cue.atSeconds),regions=this.song.regions;let index=Math.max(0,regions.findIndex((item)=>this.current.positionSeconds>=item.startSeconds&&this.current.positionSeconds<item.endSeconds)),boundary=regions[index]?.endSeconds??this.current.positionSeconds,cueAt=boundary-lead,repeatAt=repeatPrefix?cueAt-this.twoBeatSeconds():null,warningAt=repeatAt??cueAt;if(warningAt<=this.current.positionSeconds+.05&&index+1<regions.length){boundary=regions[++index]!.endSeconds;cueAt=boundary-lead;repeatAt=repeatPrefix?cueAt-this.twoBeatSeconds():null;warningAt=repeatAt??cueAt;}if(warningAt<=this.current.positionSeconds)throw new Error("Not enough song remains to give the full transition announcement");this.effects.announceRecovery(regionId,cueAt,repeatAt);this.current={...this.current,recoveryRegionId:regionId,recoveryCueAtSeconds:cueAt,recoverAtSeconds:boundary};}
  private twoBeatSeconds():number{return 120/this.song.selectedBpm;}
  private requireReady():void{if(this.current.fault)throw new Error("Clear panic or fault before continuing playback");if(!this.current.ready)throw new Error("Performance session is not ready");}
}

export type KeyboardAction="play-pause"|"panic"|"previous-section"|"next-section"|"loop"|"toggle-click"|"toggle-cue"|"toggle-pad";
export function keyboardAction(key:string):KeyboardAction|null{const normalized=key.toLowerCase();return normalized===" "?"play-pause":normalized==="escape"?"panic":normalized==="arrowleft"?"previous-section":normalized==="arrowright"?"next-section":normalized==="l"?"loop":normalized==="c"?"toggle-click":normalized==="q"?"toggle-cue":normalized==="p"?"toggle-pad":null;}
export function validateRoutingPlan(plan:RoutingPlan):void{const used=new Set<number>();for(const [bus,route] of Object.entries(plan)){if(!Number.isInteger(route.firstOutput)||route.firstOutput<1)throw new Error(`${bus} route must begin on a positive output`);for(let channel=route.firstOutput;channel<route.firstOutput+route.channels;channel+=1){if(used.has(channel))throw new Error(`Output ${channel} is assigned more than once`);used.add(channel);}}}
function regionAt(song:PreparedSong,seconds:number):Region|undefined{return song.regions.find((region)=>seconds>=region.startSeconds&&seconds<region.endSeconds)??song.regions.at(-1);}
function createMixerState(song:PreparedSong):LiveMixerState{const channels:MixerChannelState[]=song.stems.map((_,index)=>({id:`stem-${index}`,index,kind:"stem",gain:1,muted:false,solo:false,iem:false}));for(const kind of ["click","cue","pad"] as const){const index=channels.length;channels.push({id:kind,index,kind,gain:1,muted:false,solo:false,iem:false});}return{masterGain:1,channels};}
function unverifiedReadiness():PerformanceReadinessReport{return{ready:true,status:"Ready with warnings",checks:[{id:"runtime",label:"Runtime readiness",level:"warning",detail:"Runtime readiness was not supplied by the desktop host"}]};}
