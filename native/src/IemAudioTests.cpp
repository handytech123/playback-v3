#define PLAYBACK_IEM_TEST 1
#include "Main.cpp"
#include <stdexcept>

namespace {
void near(float actual, float expected, const char* message) {
    if (std::abs(actual-expected)>0.00001f) throw std::runtime_error(message);
}
struct Tone : juce::AudioSource {
    int reads=0;
    void prepareToPlay(int,double) override {}
    void releaseResources() override {}
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& info) override {
        ++reads;
        for(int ch=0;ch<info.buffer->getNumChannels();++ch)
            for(int i=0;i<info.numSamples;++i) info.buffer->setSample(ch,info.startSample+i,0.25f);
    }
};
void testRoute() {
    Tone tone;GainRampAudioSource fader(tone);TransportGate gate(fader);
    RoutedAudioSource route(gate,2,0,1);
    route.setPreFaderSource(fader,true);route.setIemFirstDestination(2);
    route.setIemGain(playback::iem::stemHeadroomGain);route.setIemEnabled(true);
    route.prepareToPlay(64,48000);gate.setOpen(true);
    juce::AudioBuffer<float> buffer(5,80);juce::AudioSourceChannelInfo info(&buffer,8,64);
    for(float gain:{1.0f,0.2f,0.0f,1.2f}) {
        buffer.clear();fader.setGain(gain);route.getNextAudioBlock(info);
        near(buffer.getSample(0,12),0.25f*gain,"audience gain incorrect");
        near(buffer.getSample(2,12),0.03125f,"IEM followed audience gain/mute");
        near(buffer.getSample(1,12),0,"route leaked to unused output");
        near(buffer.getSample(2,0),0,"route ignored block offset");
    }
    if(tone.reads!=4) throw std::runtime_error("pre-fader path read source twice");
    gldExternalOutputMask.store(1);fader.setGain(0.1f);route.getNextAudioBlock(info);
    near(buffer.getSample(0,12),0.25f,"mapped return still applies local bus attenuation");
    near(buffer.getSample(0,12)*0.1f,0.025f,"GLD attenuation was applied more than once");
    near(buffer.getSample(2,12),0.03125f,"GLD ownership changed IEM");
    gldExternalOutputMask.store(2);route.getNextAudioBlock(info);
    near(buffer.getSample(0,12),0.025f,"unmapped return lost local gain");
    gldExternalOutputMask.store(0);
    route.setIemEnabled(false);route.getNextAudioBlock(info);
    near(buffer.getSample(2,12),0,"IEM off ignored");
    route.setIemEnabled(true);gate.setOpen(false);route.getNextAudioBlock(info);
    near(buffer.getSample(2,12),0,"closed transport replayed old IEM buffer");
    gate.setOpen(true);route.setIemDestinationChannels(2);route.getNextAudioBlock(info);
    near(buffer.getSample(2,12),0.03125f,"stereo IEM left wrong");
    near(buffer.getSample(3,12),0.03125f,"stereo IEM right wrong");
    GainRampAudioSource master(route);master.setFixedGainChannels(2,2,globalOutputTrimGain);
    master.prepareToPlay(64,48000);master.setGain(0);master.getNextAudioBlock(info);
    near(buffer.getSample(0,12),0,"master failed to mute audience");
    near(buffer.getSample(2,12),0.03125f*globalOutputTrimGain,"master altered IEM");
    gate.setPositionSamples(0);gate.setEndPositionSamples(16);gate.setOpen(true);
    master.getNextAudioBlock(info);
    near(buffer.getSample(2,12),0.03125f*globalOutputTrimGain,"partial block lost IEM audio");
    near(buffer.getSample(2,30),0,"partial block leaked beyond transport end");
    master.releaseResources();
}
void testEngineIem() {
    // Exercise both real engine channel-control paths without opening audio or MIDI devices.
    for(bool dual:{false,true}) {
        Tone tone;ArmedSetEngine engine;engine.dualDeckMode=dual;
        auto gain=std::make_unique<GainRampAudioSource>(tone);
        auto route=std::make_unique<RoutedAudioSource>(*gain,2,0,1);
        route->setPreFaderSource(*gain,true);route->setIemFirstDestination(2);
        route->setIemDestinationChannels(1);route->prepareToPlay(64,48000);
        auto* rendered=route.get();
        auto& deck=*engine.activeDeck;
        auto& gains=dual?deck.stemGains:engine.stemGains;
        auto& routes=dual?deck.stemRoutes:engine.stemRoutes;
        (dual?deck.stemFaders:engine.stemFaders).push_back(1);
        (dual?deck.stemTrims:engine.stemTrims).push_back(1);
        (dual?deck.stemMuted:engine.stemMuted).push_back(false);
        (dual?deck.stemSolo:engine.stemSolo).push_back(false);
        (dual?deck.stemIem:engine.stemIem).push_back(true);
        gains.push_back(std::move(gain));routes.push_back(std::move(route));
        juce::AudioBuffer<float> buffer(4,64);juce::AudioSourceChannelInfo info(&buffer,0,64);
        for(bool mute:{false,true}) for(bool solo:{false,true}) for(float value:{1.0f,0.0f,0.1f}) {
            if(!engine.setMixerChannel(0,value,mute,solo,true)) throw std::runtime_error("channel rejected");
            for(int i=0;i<30;++i) rendered->getNextAudioBlock(info);
            near(buffer.getSample(2,32),0.03125f,"native channel fader/mute/solo affected IEM");
            near(buffer.getSample(0,32),mute?0:0.25f*mixerFaderToGain(value),"native audience mix incorrect");
        }
        auto& solos=dual?deck.stemSolo:engine.stemSolo;
        solos.push_back(true);
        engine.setMixerChannel(0,1,false,false,true);
        for(int i=0;i<30;++i) rendered->getNextAudioBlock(info);
        near(buffer.getSample(0,32),0,"another channel solo failed to isolate audience");
        near(buffer.getSample(2,32),0.03125f,"another channel solo altered IEM");
        solos.pop_back();
        engine.setMixerChannel(0,1,false,false,false);rendered->getNextAudioBlock(info);
        near(buffer.getSample(2,32),0,"engine ignored independent IEM off");
        engine.setMixerChannel(0,1,false,false,true);engine.setMusic(false);rendered->getNextAudioBlock(info);
        near(buffer.getSample(2,32),0,"music transport safety switch ignored");
        engine.setMusic(true);engine.panic();rendered->getNextAudioBlock(info);
        near(buffer.getSample(2,32),0,"panic safety ignored");
        engine.setMusic(true);engine.recover();
        engine.setRouting({0},{1},4,1,5,1,6,1,2,1);
        if(engine.setExternalOutputs({3}))throw std::runtime_error("IEM output accepted for GLD bypass");
        if(!engine.setExternalOutputs({1}))throw std::runtime_error("dedicated return rejected");
        engine.setMixerChannel(0,0.1f,false,false,true);
        for(int i=0;i<30;++i)rendered->getNextAudioBlock(info);
        near(buffer.getSample(0,32),0.25f,"native mapped bus still attenuated");
        near(buffer.getSample(2,32),0.03125f,"native ownership affected IEM feed");
        engine.setStemTrim(0,0.1f,false,false,true);
        for(int i=0;i<30;++i)rendered->getNextAudioBlock(info);
        near(buffer.getSample(0,32),0.25f*mixerFaderToGain(0.1f),"individual stem trim did not affect mapped bus audio");
        near(buffer.getSample(2,32),0.03125f,"individual stem trim affected pre-fader IEM");
        engine.setStemTrim(0,1.0f,false,false,true);
        for(float level : {1.25f,1.7782794f,maxGldReturnFader}) {
            engine.setMixerChannel(0,level,false,false,true);
            for(int i=0;i<30;++i)rendered->getNextAudioBlock(info);
            near(buffer.getSample(0,32),0.25f,"extended GLD bus gain changed native audience level");
            near(buffer.getSample(2,32),0.03125f,"extended GLD bus gain changed IEM level");
        }
        engine.setMixerChannel(0,0.1f,false,false,true);
        engine.setExternalOutputs({});for(int i=0;i<30;++i)rendered->getNextAudioBlock(info);
        near(buffer.getSample(0,32),0.25f*mixerFaderToGain(0.1f),"explicit local mode failed to restore gain");
        rendered->releaseResources();
    }
}
}
int main() {
    juce::ScopedJuceInitialiser_GUI init;
    try {
        const std::vector<unsigned char> mixed={0xb1,0x63,0x29,0xf0,0,0,0x1a,0x50,0x10,1,0,1,6,0x29,1,0xf7,0x91,0x29,0x3f};
        const auto messages=midiOutputMessages(mixed);
        if(messages.size()!=3 || messages[1].second!=13)throw std::runtime_error("SysEx stream framing failed");
        for(const std::vector<unsigned char>& invalid : {std::vector<unsigned char>{0xf0,0,1}, {0xb1,0x63}, {0xb1,0x63,0xf7}, {0xf0,0,0x91,0xf7}}) {
            bool rejected=false;try{midiOutputMessages(invalid);}catch(...){rejected=true;}
            if(!rejected)throw std::runtime_error("invalid MIDI stream accepted");
        }
        near(externalFaderToGain(.5f),mixerFaderToGain(.5f),"legacy relative gain changed");
        near(mixerFaderToGain(maxGldReturnFader),mixerFaderToGain(1.25f),"local audio ceiling changed");
        testRoute();testEngineIem();std::cout<<"PASS: pre-fader audio, native legacy/dual-deck controls, independent IEM off, transport, panic, master isolation\n";return 0; }
    catch(const std::exception& e) {std::cerr<<e.what()<<'\n';return 1;}
}
