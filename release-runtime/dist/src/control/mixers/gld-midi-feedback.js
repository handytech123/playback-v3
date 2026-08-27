const FADER_POINTS = [[-54,0],[-45,0x11],[-40,0x1b],[-35,0x25],[-30,0x2f],[-25,0x39],[-20,0x43],[-15,0x4d],[-10,0x57],[-5,0x61],[0,0x6b],[5,0x74],[10,0x7f]];

export class GldMidiFeedback {
    constructor({midiChannel=2,midiInputName="",mapping={},onFeedback=()=>{}}={}) {
        this.onFeedback=onFeedback;this.received=0;this.last=null;this.configure({midiChannel,midiInputName,mapping});this.reset();
    }
    configure({midiChannel,midiInputName,mapping}) {
        if(!Number.isInteger(midiChannel)||midiChannel<1||midiChannel>16)throw Error("GLD feedback MIDI channel must be 1-16");
        this.midiChannel=midiChannel;this.midiInputName=String(midiInputName??"");
        this.inputs=new Map(Object.entries(mapping??{}).map(([bus,input])=>[0x20+Number(input)-1,{bus,input:Number(input)}]));
        this.reset();return this.state();
    }
    state() {return {enabled:Boolean(this.midiInputName),midiInputName:this.midiInputName,midiChannel:this.midiChannel,received:this.received,last:this.last};}
    reset() {this.parameter=null;this.parameterKind=null;this.parameterAt=0;}
    handle(event,now=Date.now()) {
        if(!this.midiInputName||!event||!Number.isFinite(now))return null;
        const status=Number(event.status),data1=Number(event.data1),data2=Number(event.data2);
        if((status&0x0f)!==this.midiChannel-1)return null;
        const kind=status&0xf0;
        if(kind===0x90) {
            if(data2===0)return null;
            const target=this.inputs.get(data1);
            if(!target||(data2!==0x7f&&data2!==0x3f))return null;
            return this.emit({...target,type:"mute",muted:data2===0x7f,raw:data2},now);
        }
        if(kind!==0xb0)return null;
        if(data1===0x63) {this.parameter=this.inputs.get(data2)??null;this.parameterKind=null;this.parameterAt=now;return null;}
        if(data1===0x62) {this.parameterKind=data2===0x17?"fader":null;this.parameterAt=now;return null;}
        if(data1!==0x06)return null;
        const target=this.parameter,valid=target&&this.parameterKind==="fader"&&now-this.parameterAt<=500&&Number.isInteger(data2)&&data2>=0&&data2<=0x7f;
        this.reset();if(!valid)return null;
        const db=gldDbFromFaderValue(data2),gain=db==="-inf"?0:Math.pow(10,db/20);
        return this.emit({...target,type:"fader",gain,db,raw:data2},now);
    }
    emit(feedback,now) {const value={...feedback,receivedAt:now};this.received++;this.last=value;this.onFeedback(value);return value;}
}

export function gldDbFromFaderValue(value) {
    if(!Number.isInteger(value)||value<0||value>0x7f)throw Error("GLD fader value must be 0-127");
    if(value===0)return "-inf";
    for(let index=0;index<FADER_POINTS.length-1;index++) {
        const lower=FADER_POINTS[index],upper=FADER_POINTS[index+1];
        if(value>=lower[1]&&value<=upper[1])return lower[0]+(upper[0]-lower[0])*((value-lower[1])/(upper[1]-lower[1]));
    }
    return 10;
}
