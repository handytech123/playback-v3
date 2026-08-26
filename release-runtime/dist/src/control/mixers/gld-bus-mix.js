export const PLAYBACK_RETURNS = {drums:10,bass:12,acoustic:14,electric:16,keys:36,strings:37,vocals:39,other:41,pad:33};
export const BUS_IDS = ['acoustic','electric','bass','keys','strings','drums','vocals','other','pad'];
export function busId(song, channel) {
    if (channel.kind !== 'stem') return channel.kind === 'pad' ? 'pad' : null;
    const role = song.stems[channel.index]?.role ?? '';
    // Performance mode labels stems by role; keep this ordering aligned with its mixer groups.
    const text = role.toLowerCase().replace(/[_-]+/g,' ');
    if (/\b(acoustic|acous|ag)\b/.test(text)) return 'acoustic';
    if (/\b(electric|elec|eg)\s*\d*\b/.test(text) || /\bguitar\b/.test(text)) return 'electric';
    if (/\bbass\b/.test(text)) return 'bass';
    if (/\b(piano|keys?|organ|rhodes|synth)\b/.test(text)) return 'keys';
    if (/\b(strings?|violin|viola|cello)\b/.test(text)) return 'strings';
    if (/\b(drums?|kick|snare|tom|toms|cymbal|loop|loops|perc|percussion|shaker|tambourine|clap)\b/.test(text)) return 'drums';
    if (/\b(vocals?|bgv|bgvs|choir|alto|tenor|soprano|lead vocal)\b/.test(text)) return 'vocals';
    return 'other';
}
export function captureBusMix(song, mixer) {
    const groups = new Map();
    for (const channel of mixer.channels) {
        const id = busId(song,channel);
        if (!id) continue;
        if (!Number.isFinite(channel.gain) || channel.gain < 0 || channel.gain > 3.1622776601683795) throw Error('Invalid bus gain');
        if (!groups.has(id)) groups.set(id,[]);
        groups.get(id).push(channel);
    }
    return Object.fromEntries([...groups].map(([id,channels])=>[id,{
        gain:channels.reduce((sum,c)=>sum+c.gain,0)/channels.length,
        muted:channels.every(c=>c.muted),
    }]));
}
export function applyBusMix(song, channels, buses) {
    if (!buses) return channels;
    return channels.map(channel=>{
        const saved=buses[busId(song,channel)];
        if (!saved) return channel;
        if (!Number.isFinite(saved.gain) || saved.gain<0 || saved.gain>3.1622776601683795 || typeof saved.muted!=='boolean') throw Error('Invalid saved bus mix');
        return {...channel,gain:saved.gain,muted:saved.muted};
    });
}
export function validateConfig(value) {
    if (!value || !['midi','tcp'].includes(value.transport)) throw Error('Choose MIDI or network');
    if (!Number.isInteger(value.midiChannel)||value.midiChannel<1||value.midiChannel>16) throw Error('MIDI channel must be 1–16');
    if (value.transport==='midi' && !value.midiOutputName?.trim()) throw Error('Select a MIDI output');
    if (value.transport==='tcp' && (!value.host?.trim()||!Number.isInteger(value.port)||value.port<1||value.port>65535)) throw Error('Invalid GLD network address');
    const map={};const targets=new Set();
    for (const [id,mix] of Object.entries(value.mapping??{})) {
        if (!BUS_IDS.includes(id)||mix!==PLAYBACK_RETURNS[id]) throw Error('Only the verified Bank 1/D Playback return channels may be mapped');
        if (targets.has(mix)) throw Error('Two Playback buses cannot control the same GLD mix');
        map[id]=mix;targets.add(mix);
    }
    return {exclusiveEnabled:value.exclusiveEnabled!==false,transport:value.transport,midiChannel:value.midiChannel,midiOutputName:String(value.midiOutputName??''),host:String(value.host??'').trim(),port:value.port??51325,mapping:map};
}
export function gainDb(gain) {
    if (!Number.isFinite(gain)||gain<0||gain>3.1622776601683795) throw Error('Invalid bus gain');
    return gain===0 ? '-inf' : Math.max(-54,Math.min(10,20*Math.log10(gain)));
}
export function busIntents(buses, mapping) {
    const intents=[];
    for (const [id,mix] of Object.entries(mapping)) {
        if (!BUS_IDS.includes(id)||mix!==PLAYBACK_RETURNS[id]) throw Error('Invalid GLD bus mapping');
        const bus=buses[id];if(!bus)continue;
        if (typeof bus.muted!=='boolean') throw Error('Invalid bus mute');
        const strip={kind:'input',number:mix};
        // Mute first when needed; set the level before unmuting a bus.
        if(bus.muted)intents.push({type:'mute',strip,muted:true});
        intents.push({type:'fader',strip,db:gainDb(bus.gain)});
        if(!bus.muted)intents.push({type:'mute',strip,muted:false});
    }
    return intents;
}

// GLD firmware 1.4+ palette: red, green, yellow, blue, purple, light blue, white.
// All eight GLD choices, including Off, are used once across the eight music buses.
export const GLD_BUS_COLORS = Object.freeze({drums:1,bass:2,acoustic:6,electric:5,keys:4,strings:3,vocals:7,other:0,pad:5});
export function busColorIntents(mapping) {
    return Object.entries(mapping).map(([id,number])=>{
        if(!BUS_IDS.includes(id)||number!==PLAYBACK_RETURNS[id])throw Error('Invalid GLD bus color mapping');
        return {type:'color',strip:{kind:'input',number},color:GLD_BUS_COLORS[id]};
    });
}
