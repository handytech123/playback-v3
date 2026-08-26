// GLD Editor scale landmarks, from bottom to top. Stored values remain gain,
// so changing the display never rewrites a saved mix or sends a fader command.
function playbackGldPoints() { return [[-54,0],[-40,125],[-30,250],[-20,375],[-10,500],[-5,625],[0,770],[5,900],[10,1000]]; }
function playbackGldGainToPosition(gain) {
    if (!(gain>0)) return 0;
    const db=Math.max(-54,Math.min(10,20*Math.log10(gain))),points=playbackGldPoints();
    for(let i=1;i<points.length;i++)if(db<=points[i][0]) {
        const [low,p0]=points[i-1],[high,p1]=points[i];return p0+(db-low)/(high-low)*(p1-p0);
    }
    return 1000;
}
function playbackGldPositionToGain(position) {
    if(!(position>0))return 0;
    const p=Math.min(1000,position),points=playbackGldPoints();
    for(let i=1;i<points.length;i++)if(p<=points[i][1]) {
        const [low,p0]=points[i-1],[high,p1]=points[i];
        const db=Math.max(-53.5,Math.round((low+(p-p0)/(p1-p0)*(high-low))*10)/10);
        return Math.pow(10,db/20);
    }
    return Math.pow(10,.5);
}
function playbackGldDbLabel(gain) {
    if(!(gain>0))return '−∞ dB';
    const db=Math.round(20*Math.log10(gain)*10)/10;
    return `${db>0?'+':''}${db===0?'0.0':db.toFixed(1)} dB`;
}
function playbackGldScaleMarkup() {
    return '<span class="gld-fader-scale" aria-hidden="true">'+[[-54,'−∞'],[-40,'−40'],[-30,'−30'],[-20,'−20'],[-10,'−10'],[-5,'−5'],[0,'0'],[5,'+5'],[10,'+10']].map(([db,label])=>`<span class="${db===0?'unity':''}" style="bottom:${playbackGldGainToPosition(db===-54?0:Math.pow(10,db/20))/10}%">${label}</span>`).join('')+'</span>';
}
function playbackGldGroupEnabled(group) {
    const c=globalThis.playbackGldDisplayConfig;
    const id=group.id==='dynamic-pad'?'pad':group.id.replace(/^bus-/,'');
    return !!c && c.exclusiveEnabled!==false && !!c.mapping?.[id];
}
function playbackGldRefreshFader(strip,group) {
    const fader=strip.querySelector('[data-mixer-fader]');
    if(!fader)return;
    const enabled=playbackGldGroupEnabled(group);
    strip.classList.toggle('gld-db-channel',enabled);
    fader.min='0';fader.max=enabled?'1000':'1.25';fader.step=enabled?'1':'0.01';
    if(document.activeElement!==fader)fader.value=String(enabled?playbackGldGainToPosition(group.gain):Math.min(1.25,group.gain));
    const readout=enabled?playbackGldDbLabel(group.gain):`${Math.round(group.gain*100)}%`;
    if(document.activeElement!==fader)strip.querySelector('output').value=readout;
    fader.setAttribute('aria-valuetext',readout);
    fader.title=enabled?`${group.label} GLD level: ${readout} (−∞ to +10 dB)`:fader.title;
}
