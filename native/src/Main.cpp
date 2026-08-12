#include <juce_audio_utils/juce_audio_utils.h>
#include <algorithm>
#include <chrono>
#include <atomic>
#include <iostream>
#include <future>
#include <cmath>
#include <iomanip>
#include <memory>
#include <map>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace {
using Clock = std::chrono::steady_clock;
double elapsedMs(Clock::time_point start) { return std::chrono::duration<double, std::milli>(Clock::now() - start).count(); }
constexpr float globalOutputTrimGain = 1.995262315f; // +6.0 dB after the complete app mix.
constexpr float maxMixerFader = 1.25f;
float mixerFaderToGain(float value) {
    const auto fader = juce::jlimit(0.0f, maxMixerFader, value);
    if (fader <= 0.0f) return 0.0f;
    if (fader <= 1.0f) return std::pow(fader, 1.6f);
    const auto boostDb = ((fader - 1.0f) / (maxMixerFader - 1.0f)) * 6.0f;
    return std::pow(10.0f, boostDb / 20.0f);
}

class TransportGate final : public juce::AudioSource {
public:
    explicit TransportGate(juce::AudioSource& sourceToUse) : source(sourceToUse) {}
    void prepareToPlay(int blockSize, double sampleRate) override { source.prepareToPlay(blockSize, sampleRate); }
    void releaseResources() override { source.releaseResources(); }
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& info) override {
        if (open.load(std::memory_order_acquire)) {
            if (awaitingFirstBlock.exchange(false,std::memory_order_acq_rel)) {
                const auto now=std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now().time_since_epoch()).count();
                firstBlockLatencyNanoseconds.store(now-playRequestNanoseconds.load(std::memory_order_acquire),std::memory_order_release);
            }
            const auto position=renderedSamples.load(std::memory_order_acquire),end=endPositionSamples.load(std::memory_order_acquire),remaining=end>0?end-position:static_cast<juce::int64>(info.numSamples);
            if(remaining<=0){open.store(false,std::memory_order_release);info.clearActiveBufferRegion();return;}
            const auto samples=static_cast<int>(juce::jmin<juce::int64>(remaining,info.numSamples));
            juce::AudioSourceChannelInfo limited(info.buffer,info.startSample,samples);source.getNextAudioBlock(limited);
            if(samples<info.numSamples){info.buffer->clear(info.startSample+samples,info.numSamples-samples);open.store(false,std::memory_order_release);}
            renderedSamples.store(position+samples,std::memory_order_release);
        }
        else info.clearActiveBufferRegion();
    }
    void setOpen(bool shouldOpen) { open.store(shouldOpen, std::memory_order_release); }
    void beginPlay() { playRequestNanoseconds.store(std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now().time_since_epoch()).count(),std::memory_order_release);awaitingFirstBlock.store(true,std::memory_order_release);open.store(true,std::memory_order_release); }
    double getFirstBlockLatencyMs() const { return firstBlockLatencyNanoseconds.load(std::memory_order_acquire)/1000000.0; }
    bool isOpen() const { return open.load(std::memory_order_acquire); }
    void setEndPositionSamples(juce::int64 samples) { endPositionSamples.store(juce::jmax<juce::int64>(0,samples),std::memory_order_release); }
    void setPositionSamples(juce::int64 samples) { renderedSamples.store(samples, std::memory_order_release); }
    juce::int64 getPositionSamples() const { return renderedSamples.load(std::memory_order_acquire); }
private:
    juce::AudioSource& source;
    std::atomic<bool> open { false };
    std::atomic<juce::int64> renderedSamples { 0 };
    std::atomic<juce::int64> endPositionSamples { 0 };
    std::atomic<juce::int64> playRequestNanoseconds { 0 }, firstBlockLatencyNanoseconds { 0 };
    std::atomic<bool> awaitingFirstBlock { false };
};

class ScheduledAudioSource final : public juce::AudioSource {
public:
    struct Event { Event(std::string eventId,juce::int64 sample,std::shared_ptr<juce::AudioBuffer<float>> value,int maximum,int fade):id(std::move(eventId)),startSample(sample),audio(std::move(value)),maxSamples(maximum),fadeSamples(fade){}std::string id;std::atomic<juce::int64> startSample;std::shared_ptr<juce::AudioBuffer<float>> audio;int maxSamples,fadeSamples; };
    void addEvent(double seconds, std::shared_ptr<juce::AudioBuffer<float>> audio, double sampleRate,const std::string& id={},double maxDurationSeconds=0) {
        const auto maximum=maxDurationSeconds>0?static_cast<int>(std::llround(maxDurationSeconds*sampleRate)):0;
        const auto fade=maximum>0?juce::jmin(maximum,static_cast<int>(std::llround(0.01*sampleRate))):0;
        events.push_back(std::make_shared<Event>(id,static_cast<juce::int64>(std::llround(seconds*sampleRate)),std::move(audio),maximum,fade));
    }
    bool moveEvent(const std::string& id,double seconds,double sampleRate){for(const auto& event:events)if(event->id==id){event->startSample.store(static_cast<juce::int64>(std::llround(seconds*sampleRate)),std::memory_order_release);return true;}return false;}
    int eventCount() const { return static_cast<int>(events.size()); }
    void clearEvents(){events.clear();position.store(0,std::memory_order_release);}
    void prepareToPlay(int, double) override {}
    void releaseResources() override {}
    void setPositionSamples(juce::int64 value) { position.store(value, std::memory_order_release); }
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& info) override {
        info.clearActiveBufferRegion();
        const auto blockStart=position.load(std::memory_order_acquire), blockEnd=blockStart+info.numSamples;
        for (const auto& event:events) {
            const auto eventStart=event->startSample.load(std::memory_order_acquire);
            const auto eventLength=event->maxSamples>0?juce::jmin(event->maxSamples,event->audio->getNumSamples()):event->audio->getNumSamples();
            const auto eventEnd=eventStart+eventLength;
            if (eventEnd<=blockStart || eventStart>=blockEnd) continue;
            const auto sourceOffset=static_cast<int>(juce::jmax<juce::int64>(0,blockStart-eventStart));
            const auto destinationOffset=static_cast<int>(juce::jmax<juce::int64>(0,eventStart-blockStart));
            const auto samples=juce::jmin(eventLength-sourceOffset,info.numSamples-destinationOffset);
            for (int channel=0; channel<info.buffer->getNumChannels(); ++channel) {
                const auto sourceChannel=juce::jmin(channel,event->audio->getNumChannels()-1);
                if(event->maxSamples<=0)info.buffer->addFrom(channel,info.startSample+destinationOffset,*event->audio,sourceChannel,sourceOffset,samples);
                else for(int index=0;index<samples;++index){const auto sourceIndex=sourceOffset+index;const auto gain=event->fadeSamples>0&&sourceIndex>=eventLength-event->fadeSamples?static_cast<float>(eventLength-sourceIndex)/event->fadeSamples:1.0f;info.buffer->addSample(channel,info.startSample+destinationOffset+index,event->audio->getSample(sourceChannel,sourceIndex)*gain);}
            }
        }
        position.store(blockEnd,std::memory_order_release);
    }
private:
    std::vector<std::shared_ptr<Event>> events;
    std::atomic<juce::int64> position { 0 };
};

class GainRampAudioSource final : public juce::AudioSource {
public:
    explicit GainRampAudioSource(juce::AudioSource& sourceToUse) : source(sourceToUse) {}
    void prepareToPlay(int blockSize,double rate) override { sampleRate.store(rate,std::memory_order_release);source.prepareToPlay(blockSize,rate); }
    void releaseResources() override { source.releaseResources(); }
    void setGain(float value,double seconds=0) { requestedRamp.store(static_cast<int>(seconds*sampleRate.load(std::memory_order_acquire)),std::memory_order_release);target.store(value,std::memory_order_release); }
    float getTargetGain() const { return target.load(std::memory_order_acquire); }
    float getPeakLevel() const { return peak.load(std::memory_order_acquire); }
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& info) override {
        source.getNextAudioBlock(info);const auto requested=target.load(std::memory_order_acquire);
        if(requested!=activeTarget){activeTarget=requested;remaining=juce::jmax(0,requestedRamp.load(std::memory_order_acquire));}
        const auto rampCount=juce::jmin(remaining,info.numSamples);
        if(rampCount>0){const auto end=current+(activeTarget-current)*static_cast<float>(rampCount)/static_cast<float>(remaining);for(int channel=0;channel<info.buffer->getNumChannels();++channel)info.buffer->applyGainRamp(channel,info.startSample,rampCount,current,end);current=end;remaining-=rampCount;}
        if(rampCount<info.numSamples){current=activeTarget;for(int channel=0;channel<info.buffer->getNumChannels();++channel)info.buffer->applyGain(channel,info.startSample+rampCount,info.numSamples-rampCount,current);}
        float nextPeak=0.0f;for(int channel=0;channel<info.buffer->getNumChannels();++channel)nextPeak=juce::jmax(nextPeak,info.buffer->getMagnitude(channel,info.startSample,info.numSamples));peak.store(nextPeak,std::memory_order_release);
    }
private:
    juce::AudioSource& source;std::atomic<float> target{1.0f},peak{0.0f};std::atomic<int> requestedRamp{0};std::atomic<double> sampleRate{48000.0};float current=1.0f,activeTarget=1.0f;int remaining=0;
};

class RoutedAudioSource final : public juce::AudioSource {
public:
    RoutedAudioSource(juce::AudioSource& sourceToUse,int sourceChannelCount,int firstDestinationChannelToUse,int destinationChannelCountToUse=0):source(sourceToUse),sourceChannels(sourceChannelCount),firstDestination(firstDestinationChannelToUse),destinationChannels(destinationChannelCountToUse>0?destinationChannelCountToUse:sourceChannelCount){}
    void setFirstDestination(int value){firstDestination=value;}
    void setDestinationChannels(int value){destinationChannels=juce::jlimit(1,2,value);}
    void setIemFirstDestination(int value){iemFirstDestination=value;}
    void setIemDestinationChannels(int value){iemDestinationChannels=juce::jlimit(1,2,value);}
    void prepareToPlay(int blockSize,double rate)override{scratch.setSize(sourceChannels,blockSize);source.prepareToPlay(blockSize,rate);}
    void releaseResources()override{source.releaseResources();scratch.setSize(0,0);}
    void setIemEnabled(bool enabled){iemEnabled.store(enabled,std::memory_order_release);}
    bool isIemEnabled()const{return iemEnabled.load(std::memory_order_acquire);}
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& info)override{if(scratch.getNumSamples()<info.numSamples)scratch.setSize(sourceChannels,info.numSamples,false,false,true);scratch.clear();juce::AudioSourceChannelInfo sourceInfo(&scratch,0,info.numSamples);source.getNextAudioBlock(sourceInfo);info.clearActiveBufferRegion();const auto available=info.buffer->getNumChannels();if(available<=0)return;if(firstDestination>=0){if(destinationChannels==1){if(firstDestination<available){const float gain=sourceChannels>1?0.5f:1.0f;for(int channel=0;channel<sourceChannels;++channel)info.buffer->addFrom(firstDestination,info.startSample,scratch,juce::jmin(channel,scratch.getNumChannels()-1),0,info.numSamples,gain);}}else if(sourceChannels==1){for(int channel=0;channel<destinationChannels;++channel){const auto destination=firstDestination+channel;if(destination<available)info.buffer->addFrom(destination,info.startSample,scratch,0,0,info.numSamples);}}else for(int channel=0;channel<sourceChannels;++channel){const auto destination=firstDestination+channel;if(destination<available)info.buffer->addFrom(destination,info.startSample,scratch,juce::jmin(channel,scratch.getNumChannels()-1),0,info.numSamples);}}if(iemEnabled.load(std::memory_order_acquire)&&iemFirstDestination>=0){const float gain=iemDestinationChannels==1&&sourceChannels>1?0.5f:1.0f;for(int iemChannel=0;iemChannel<iemDestinationChannels;++iemChannel){const auto destination=iemFirstDestination+iemChannel;if(destination>=0&&destination<available){if(iemDestinationChannels==1)for(int sourceChannel=0;sourceChannel<sourceChannels;++sourceChannel)info.buffer->addFrom(destination,info.startSample,scratch,sourceChannel,0,info.numSamples,gain);else info.buffer->addFrom(destination,info.startSample,scratch,sourceChannels==1?0:juce::jmin(iemChannel,scratch.getNumChannels()-1),0,info.numSamples);}}}}
private:
    juce::AudioSource& source;int sourceChannels,firstDestination,destinationChannels,iemFirstDestination{30},iemDestinationChannels{1};juce::AudioBuffer<float> scratch;std::atomic<bool> iemEnabled{false};
};

class RecoveryCueSource final : public juce::AudioSource {
public:
    void prepareToPlay(int,double) override {}
    void releaseResources() override {}
    void schedule(const juce::AudioBuffer<float>* audio,juce::int64 startSample) { audioPosition.store(0,std::memory_order_release);scheduledSample.store(startSample,std::memory_order_release);current.store(audio,std::memory_order_release); }
    int triggerCount() const { return triggers.load(std::memory_order_acquire); }
    void stop() { current.store(nullptr,std::memory_order_release);audioPosition.store(0,std::memory_order_release); }
    void setPositionSamples(juce::int64 value) { timelinePosition.store(value,std::memory_order_release); }
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& info) override {
        info.clearActiveBufferRegion();const auto blockStart=timelinePosition.load(std::memory_order_acquire),blockEnd=blockStart+info.numSamples;timelinePosition.store(blockEnd,std::memory_order_release);const auto* audio=current.load(std::memory_order_acquire);if(!audio)return;const auto eventStart=scheduledSample.load(std::memory_order_acquire);if(blockEnd<=eventStart)return;auto sourceStart=audioPosition.load(std::memory_order_acquire);const auto destinationOffset=sourceStart==0?static_cast<int>(juce::jmax<juce::int64>(0,eventStart-blockStart)):0;if(sourceStart==0)triggers.fetch_add(1,std::memory_order_release);const auto count=juce::jmin(info.numSamples-destinationOffset,audio->getNumSamples()-sourceStart);if(count<=0){stop();return;}for(int channel=0;channel<info.buffer->getNumChannels();++channel)info.buffer->addFrom(channel,info.startSample+destinationOffset,*audio,juce::jmin(channel,audio->getNumChannels()-1),sourceStart,count);sourceStart+=count;audioPosition.store(sourceStart,std::memory_order_release);if(sourceStart>=audio->getNumSamples())current.store(nullptr,std::memory_order_release);
    }
private:
    std::atomic<const juce::AudioBuffer<float>*> current{nullptr};std::atomic<int> audioPosition{0},triggers{0};std::atomic<juce::int64> timelinePosition{0},scheduledSample{0};
};

class ScheduledMidiSource final : public juce::AudioSource {
public:
    struct Event { juce::int64 sample; juce::MidiMessage message; };
    void prepareToPlay(int,double) override {}
    void releaseResources() override {}
    void addEvent(double seconds,int status,int data1,int data2,double rate){const juce::uint8 bytes[]={static_cast<juce::uint8>(status),static_cast<juce::uint8>(data1),static_cast<juce::uint8>(data2)};events.push_back({static_cast<juce::int64>(std::llround(seconds*rate)),juce::MidiMessage(bytes,3)});}
    void setOutput(std::unique_ptr<juce::MidiOutput> value){output=std::move(value);}
    void setSendEnabled(bool enabled){if(!enabled)allNotesOff();sendEnabled.store(enabled,std::memory_order_release);}
    void setPositionSamples(juce::int64 value){position.store(value,std::memory_order_release);const auto next=static_cast<size_t>(std::lower_bound(events.begin(),events.end(),value,[](const Event& event,juce::int64 sample){return event.sample<sample;})-events.begin());cursor.store(next,std::memory_order_release);allNotesOff();reconcileMidiState(next);}
    void stop(){allNotesOff();position.store(0,std::memory_order_release);cursor.store(0,std::memory_order_release);}
    int eventCount()const{return static_cast<int>(events.size());}
    int dispatchedEventCount()const{return dispatchedEvents.load(std::memory_order_acquire);}
    int flushCount()const{return flushes.load(std::memory_order_acquire);}
    int cursorPosition()const{return static_cast<int>(cursor.load(std::memory_order_acquire));}
    void clearEvents(){allNotesOff();events.clear();cursor.store(0,std::memory_order_release);position.store(0,std::memory_order_release);output.reset();sendEnabled.store(true,std::memory_order_release);dispatchedEvents.store(0,std::memory_order_release);flushes.store(0,std::memory_order_release);}
    bool isEnabled()const{return output!=nullptr&&sendEnabled.load(std::memory_order_acquire);}
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& info)override{info.clearActiveBufferRegion();const auto start=position.load(std::memory_order_acquire),end=start+info.numSamples;auto next=cursor.load(std::memory_order_acquire);while(next<events.size()&&events[next].sample<end){if(events[next].sample>=start&&output&&sendEnabled.load(std::memory_order_acquire)){output->sendMessageNow(events[next].message);dispatchedEvents.fetch_add(1,std::memory_order_release);}++next;}cursor.store(next,std::memory_order_release);position.store(end,std::memory_order_release);}
private:
    void allNotesOff(){if(!output)return;for(int channel=1;channel<=16;++channel)output->sendMessageNow(juce::MidiMessage::allNotesOff(channel));flushes.fetch_add(1,std::memory_order_release);}
    void reconcileMidiState(size_t before){if(!output||before==0)return;std::map<int,size_t> latest;for(size_t index=0;index<before;++index)if(events[index].message.isNoteOn())latest[events[index].message.getChannel()*128+events[index].message.getNoteNumber()]=index;std::vector<size_t> ordered;for(const auto& entry:latest)ordered.push_back(entry.second);std::sort(ordered.begin(),ordered.end());for(const auto index:ordered){output->sendMessageNow(events[index].message);dispatchedEvents.fetch_add(1,std::memory_order_release);}}
    std::vector<Event> events;std::atomic<size_t> cursor{0};std::atomic<int> dispatchedEvents{0},flushes{0};std::atomic<juce::int64> position{0};std::atomic<bool> sendEnabled{true};std::unique_ptr<juce::MidiOutput> output;
};

class MidiInputCapture final : public juce::MidiInputCallback {
public:
    struct Event { int status; int data1; int data2; };
    bool open(const juce::String& requestedName){close();for(const auto& device:juce::MidiInput::getAvailableDevices())if(device.name==requestedName){input=juce::MidiInput::openDevice(device.identifier,this);if(input){name=device.name;input->start();return true;}}return false;}
    void close(){if(input){input->stop();input.reset();}name.clear();std::scoped_lock lock(mutex);events.clear();}
    bool isEnabled()const{return input!=nullptr;}
    juce::String deviceName()const{return name;}
    std::vector<Event> take(){std::scoped_lock lock(mutex);std::vector<Event> result;result.swap(events);return result;}
    void handleIncomingMidiMessage(juce::MidiInput*,const juce::MidiMessage& message)override{const auto* bytes=message.getRawData();const auto size=message.getRawDataSize();if(size<1||message.isSysEx())return;std::scoped_lock lock(mutex);if(events.size()<256)events.push_back({bytes[0],size>1?bytes[1]:0,size>2?bytes[2]:0});}
private:
    std::unique_ptr<juce::MidiInput> input;juce::String name;std::mutex mutex;std::vector<Event> events;
};

class ArmedSetEngine {
public:
    ArmedSetEngine() {
        formats.registerBasicFormats();
        readAheadThread.startThread(juce::Thread::Priority::high);
    }
    juce::String openDefaultDevice() {
        const auto start = Clock::now();
        juce::String error;
        if(audioOverrideSet){error=deviceManager.initialise(0,0,nullptr,true);if(error.isEmpty()){deviceManager.setCurrentAudioDeviceType(audioOverrideType,true);juce::AudioDeviceManager::AudioDeviceSetup setup;deviceManager.getAudioDeviceSetup(setup);setup.outputDeviceName=audioOverrideName;setup.inputDeviceName={};setup.useDefaultInputChannels=false;setup.useDefaultOutputChannels=false;if(configuredOutputCount>0){setup.outputChannels.clear();setup.outputChannels.setRange(0,configuredOutputCount,true);error=deviceManager.setAudioDeviceSetup(setup,true);}else for(const auto channels:{32,16,8,6,2}){setup.outputChannels.clear();setup.outputChannels.setRange(0,channels,true);error=deviceManager.setAudioDeviceSetup(setup,true);if(error.isEmpty())break;}}}
        else {for(const auto channels:{32,16,8,6,2}){deviceManager.closeAudioDevice();error=deviceManager.initialiseWithDefaultDevices(0,channels);if(error.isEmpty())break;}}
        if(error.isNotEmpty())stereoFallback=true;
        if (error.isNotEmpty()) return error;
        player.setSource(&gate);
        deviceManager.addAudioCallback(&player);
        deviceOpenMs = elapsedMs(start);
        if (auto* device=deviceManager.getCurrentAudioDevice()){outputSampleRate=device->getCurrentSampleRate();outputChannelCount=device->getActiveOutputChannels().countNumberOfSetBits();routeReady=outputChannelCount>=22;iemReady=outputChannelCount>=32;if(!routeReady)stereoFallback=true;}
        if(midiInputOverrideSet&&midiInputOverrideEnabled)midiInputCapture.open(midiInputOverrideName);
        return {};
    }
    void setMidiOutputOverride(const juce::String& name,bool enabled){midiOverrideSet=true;midiOverrideEnabled=enabled;midiOverrideName=name;}
    void setMidiInputOverride(const juce::String& name,bool enabled){midiInputOverrideSet=true;midiInputOverrideEnabled=enabled;midiInputOverrideName=name;}
    void setAudioDeviceOverride(const juce::String& type,const juce::String& name){audioOverrideSet=true;audioOverrideType=type;audioOverrideName=name;}
    void setOutputChannelCount(int channels){configuredOutputCount=channels>=2?channels:0;}
    void setRouting(const std::vector<int>& stems,const std::vector<int>& stemWidths,int click,int clickWidth,int cue,int cueWidth,int pad,int padWidth,int iem,int iemWidth){stemOutputs=stems;stemChannels=stemWidths;clickOutput=click;clickChannels=clickWidth;cueOutput=cue;cueChannels=cueWidth;padOutput=pad;padChannels=padWidth;iemOutput=iem;iemChannels=iemWidth;clickRoute.setFirstDestination(clickOutput);clickRoute.setDestinationChannels(clickChannels);cueRoute.setFirstDestination(cueOutput);cueRoute.setDestinationChannels(cueChannels);clickRoute.setIemFirstDestination(iemOutput);cueRoute.setIemFirstDestination(iemOutput);clickRoute.setIemDestinationChannels(iemChannels);cueRoute.setIemDestinationChannels(iemChannels);}
    juce::Result arm(const juce::File& manifestFile, int songIndex) {
        const auto start = Clock::now();
        const auto parsed = juce::JSON::parse(manifestFile);
        if (!parsed.isObject()) return juce::Result::fail("Manifest is not valid JSON");
        const auto songs = parsed.getDynamicObject()->getProperty("songs");
        if (!songs.isArray() || songs.getArray()->isEmpty()) return juce::Result::fail("Manifest has no prepared songs");
        if (songIndex < 0 || songIndex >= songs.getArray()->size()) return juce::Result::fail("Song index is outside the confirmed set");
        const auto usePreloaded=songIndex==preloadedNextIndex;auto preparedReaders=usePreloaded?std::move(preloadedReaders):std::vector<std::unique_ptr<juce::AudioFormatReaderSource>>{};auto preparedTransports=usePreloaded?std::move(preloadedTransports):std::vector<std::unique_ptr<juce::AudioTransportSource>>{};auto preparedPadReader=usePreloaded?std::move(preloadedPadReader):std::unique_ptr<juce::AudioFormatReaderSource>{};auto preparedPadTransport=usePreloaded?std::move(preloadedPadTransport):std::unique_ptr<juce::AudioTransportSource>{};preloadedNextIndex=-1;resetSong();lastResetMs=elapsedMs(start);armedManifestFile=manifestFile;
        const auto firstSong = (*songs.getArray())[songIndex];
        if (!firstSong.isObject()) return juce::Result::fail("Prepared song is invalid");
        gate.setEndPositionSamples(static_cast<juce::int64>(std::llround(static_cast<double>(firstSong.getDynamicObject()->getProperty("durationSeconds"))*outputSampleRate)));
        const auto stems = firstSong.getDynamicObject()->getProperty("stems");
        if (!stems.isArray() || stems.getArray()->isEmpty()) return juce::Result::fail("Prepared song has no stems");
        const auto arrangement=firstSong.getDynamicObject()->getProperty("arrangement");
        const auto control=firstSong.getDynamicObject()->getProperty("control");
        const auto metadataValue=control.isObject()?control:arrangement;
        if(metadataValue.isObject()){
            const auto* metadata=metadataValue.getDynamicObject();const auto events=metadata->getProperty("proPresenterMidi");
            if(events.isArray())for(const auto& event:*events.getArray())if(event.isObject())midiScheduled.addEvent(static_cast<double>(event.getDynamicObject()->getProperty("atSeconds")),static_cast<int>(event.getDynamicObject()->getProperty("status")),static_cast<int>(event.getDynamicObject()->getProperty("data1")),static_cast<int>(event.getDynamicObject()->getProperty("data2")),outputSampleRate);
            midiOutputName=midiOverrideSet?(midiOverrideEnabled?midiOverrideName:juce::String()):metadata->getProperty("midiOutputName").toString();
            if(midiOutputName.isNotEmpty()){for(const auto& device:juce::MidiOutput::getAvailableDevices())if(device.name==midiOutputName){midiScheduled.setOutput(juce::MidiOutput::openDevice(device.identifier));break;}if(!midiScheduled.isEnabled())midiWarning="Configured MIDI output unavailable: "+midiOutputName;}
        }
        int stemIndex=0;for (const auto& stem : *stems.getArray()) {
            if (!stem.isObject()) return juce::Result::fail("Stem entry is invalid");
            const juce::File audioFile(stem.getDynamicObject()->getProperty("sourcePath").toString());
            if (!audioFile.existsAsFile()) return juce::Result::fail("Cached stem is missing: " + audioFile.getFullPathName());
            std::unique_ptr<juce::AudioFormatReaderSource> readerSource;std::unique_ptr<juce::AudioTransportSource> transport;
            if(stemIndex<static_cast<int>(preparedReaders.size())&&stemIndex<static_cast<int>(preparedTransports.size())){readerSource=std::move(preparedReaders[stemIndex]);transport=std::move(preparedTransports[stemIndex]);}
            else{auto reader=std::unique_ptr<juce::AudioFormatReader>(formats.createReaderFor(audioFile));if(!reader)return juce::Result::fail("Cannot decode cached stem: "+audioFile.getFullPathName());readerSource=std::make_unique<juce::AudioFormatReaderSource>(reader.release(),true);transport=std::make_unique<juce::AudioTransportSource>();transport->setSource(readerSource.get(),32768,&readAheadThread,readerSource->getAudioFormatReader()->sampleRate,2);}++stemIndex;
            const auto destination=stemIndex<=static_cast<int>(stemOutputs.size())?stemOutputs[stemIndex-1]:stemIndex-1,width=stemIndex<=static_cast<int>(stemChannels.size())?stemChannels[stemIndex-1]:1;auto stemGain=std::make_unique<GainRampAudioSource>(*transport);auto stemRoute=std::make_unique<RoutedAudioSource>(*stemGain,2,destination,width);stemRoute->setIemFirstDestination(iemOutput);stemRoute->setIemDestinationChannels(1);mixer.addInputSource(stemRoute.get(),false);
            stemFaders.push_back(1.0f);stemMuted.push_back(false);stemSolo.push_back(false);stemIem.push_back(false);stemGains.push_back(std::move(stemGain));stemRoutes.push_back(std::move(stemRoute));
            readers.push_back(std::move(readerSource));
            transports.push_back(std::move(transport));
        }
        // Start each prepared transport while disconnected from the device.
        // The shared player source is the single sample-aligned live gate.
        for (auto& transport : transports) { transport->start(); transport->setPosition(0); }
        lastStemMs=elapsedMs(start)-lastResetMs;
        musicEnabled=true;musicBusGain=1.0f;panicAttenuation=1.0f;applyStemMix(0);
        mixer.addInputSource(&midiScheduled,false);
        const auto liveAssets=firstSong.getDynamicObject()->getProperty("liveAssets");
        if (liveAssets.isObject()) {
            const auto* assets=liveAssets.getDynamicObject();
            const auto click=assets->getProperty("click");
            if (click.isObject()) {
                const auto regular=loadScheduledAsset(click.getDynamicObject()->getProperty("regularPath").toString());
                const auto accent=loadScheduledAsset(click.getDynamicObject()->getProperty("accentPath").toString());
                const auto events=click.getDynamicObject()->getProperty("events");
                if (events.isArray()) for (const auto& event:*events.getArray()) if (event.isObject()) {
                    const auto* clickEvent=event.getDynamicObject();const auto duration=clickEvent->hasProperty("maxDurationSeconds")?static_cast<double>(clickEvent->getProperty("maxDurationSeconds")):0.0;
                    clickScheduled.addEvent(static_cast<double>(clickEvent->getProperty("atSeconds")), static_cast<bool>(clickEvent->getProperty("accent"))?accent:regular, outputSampleRate,{},duration); ++clickEventCount;
                }
            }
            const auto cues=assets->getProperty("cues");
            const auto repeatCuePath=assets->getProperty("repeatCuePath").toString();
            if(repeatCuePath.isNotEmpty())repeatCue=loadScheduledAsset(repeatCuePath);
            if (cues.isArray()) for (const auto& cue:*cues.getArray()) if (cue.isObject()) {
                const auto audio=loadScheduledAsset(cue.getDynamicObject()->getProperty("audioPath").toString());
                cueScheduled.addEvent(static_cast<double>(cue.getDynamicObject()->getProperty("atSeconds")),audio,outputSampleRate,cue.getDynamicObject()->getProperty("targetRegionId").toString().toStdString());
                recoveryCues[cue.getDynamicObject()->getProperty("targetRegionId").toString().toStdString()]=audio;++cueEventCount;
            }
            const auto countIn=assets->getProperty("countIn");
            if(countIn.isArray())for(const auto& event:*countIn.getArray())if(event.isObject()){
                const auto audio=loadScheduledAsset(event.getDynamicObject()->getProperty("audioPath").toString());
                cueScheduled.addEvent(static_cast<double>(event.getDynamicObject()->getProperty("atSeconds")),audio,outputSampleRate);++cueEventCount;
            }
            clickGate.setOpen(true); scheduledCueGate.setOpen(true); cueGate.setOpen(true);
            cueMixer.addInputSource(&scheduledCueGate,false);
            cueMixer.addInputSource(&recoveryCue,false);
            cueMixer.addInputSource(&repeatCueSource,false);
            mixer.addInputSource(&clickRoute,false);
            mixer.addInputSource(&cueRoute,false);
            const auto pad=assets->getProperty("pad");
            if (pad.isObject()) {
                padKey=pad.getDynamicObject()->getProperty("key").toString();
                const juce::File padFile(pad.getDynamicObject()->getProperty("audioPath").toString());
                if(preparedPadReader&&preparedPadTransport){padReader=std::move(preparedPadReader);padTransport=std::move(preparedPadTransport);}else{auto padReaderRaw=std::unique_ptr<juce::AudioFormatReader>(formats.createReaderFor(padFile));if(!padReaderRaw)return juce::Result::fail("Cannot decode prepared pad");padReader=std::make_unique<juce::AudioFormatReaderSource>(padReaderRaw.release(),true);padTransport=std::make_unique<juce::AudioTransportSource>();padTransport->setSource(padReader.get(),32768,&readAheadThread,padReader->getAudioFormatReader()->sampleRate,2);}
                padTransport->setLooping(true); padTransport->start();
                padGain=std::make_unique<GainRampAudioSource>(*padTransport);padGain->setGain(0.0f);
                padMix=std::make_unique<GainRampAudioSource>(static_cast<juce::AudioSource&>(*padGain));padGate=std::make_unique<TransportGate>(*padMix);padGate->setOpen(true);padRoute=std::make_unique<RoutedAudioSource>(*padGate,2,padOutput,padChannels);padRoute->setIemFirstDestination(iemOutput);padRoute->setIemDestinationChannels(iemChannels);mixer.addInputSource(padRoute.get(),false);
            }
        }
        armMs = elapsedMs(start);
        lastLiveMs=armMs-lastResetMs-lastStemMs;
        cleanupRetired();
        preloadNext(parsed,songIndex+1);
        return juce::Result::ok();
    }
    juce::Result selectSong(int songIndex){return arm(armedManifestFile,songIndex);}
    double play() {
        const auto t=Clock::now();
        // A prepared AudioTransportSource may have been started long before the
        // output gate opens. Reassert the authoritative shared timeline here so
        // no read-ahead, device restart, pause, or preloaded-song state can leave
        // the audible stems behind the playhead.
        const auto timelineSample=gate.getPositionSamples();
        const auto timelineSeconds=outputSampleRate>0?static_cast<double>(timelineSample)/outputSampleRate:0.0;
        for(auto& transport:transports)transport->setPosition(timelineSeconds);
        clickScheduled.setPositionSamples(timelineSample);
        cueScheduled.setPositionSamples(timelineSample);
        midiScheduled.setPositionSamples(timelineSample);
        gate.beginPlay();playing=true;return elapsedMs(t);
    }
    double pause() { const auto t=Clock::now(); gate.setOpen(false); playing=false; return elapsedMs(t); }
    double stop() { const auto t=Clock::now(); gate.setOpen(false); playing=false;panicAttenuation=1.0f;applyStemMix(0);if(padGain)padGain->setGain(0.0f);recoveryCue.stop();repeatCueSource.stop();midiScheduled.stop();recoveryCue.setPositionSamples(0);repeatCueSource.setPositionSamples(0);gate.setPositionSamples(0); clickScheduled.setPositionSamples(0); cueScheduled.setPositionSamples(0); for (auto& x:transports) x->setPosition(0); if(padTransport)padTransport->setPosition(0); return elapsedMs(t); }
    double seek(double s) {
        const auto t=Clock::now();
        const auto resume=playing;
        gate.setOpen(false);
        gate.setPositionSamples(static_cast<juce::int64>(s*outputSampleRate));
        clickScheduled.setPositionSamples(static_cast<juce::int64>(s*outputSampleRate));
        cueScheduled.setPositionSamples(static_cast<juce::int64>(s*outputSampleRate));
        recoveryCue.setPositionSamples(static_cast<juce::int64>(s*outputSampleRate));
        repeatCueSource.setPositionSamples(static_cast<juce::int64>(s*outputSampleRate));
        midiScheduled.setPositionSamples(static_cast<juce::int64>(s*outputSampleRate));
        for (auto& x:transports) x->setPosition(s);
        if (resume) gate.setOpen(true);
        return elapsedMs(t);
    }
    int stemCount() const { return static_cast<int>(transports.size()); }
    double getDeviceOpenMs() const { return deviceOpenMs; }
    double getArmMs() const { return armMs; }
    double getResetMs()const{return lastResetMs;}double getStemMs()const{return lastStemMs;}double getLiveMs()const{return lastLiveMs;}
    double positionSeconds() const { return outputSampleRate > 0 ? static_cast<double>(gate.getPositionSamples())/outputSampleRate : 0; }
    void synchronizeTransportEnd(){if(playing&&!gate.isOpen())playing=false;}
    double startLatencyMs() const { return gate.getFirstBlockLatencyMs(); }
    const char* stateName() const { return playing ? "playing" : "paused"; }
    int getClickEventCount() const { return clickEventCount; }
    int getCueEventCount() const { return cueEventCount; }
    int getMidiEventCount() const { return midiScheduled.eventCount(); }
    bool midiEnabled() const { return midiScheduled.isEnabled(); }
    juce::String getMidiWarning() const { return midiWarning; }
    bool midiInputEnabled()const{return midiInputCapture.isEnabled();}
    juce::String midiInputDeviceName()const{return midiInputCapture.deviceName();}
    std::vector<MidiInputCapture::Event> takeMidiInputEvents(){return midiInputCapture.take();}
    int getMidiDispatchedEventCount() const { return midiScheduled.dispatchedEventCount(); }
    int getMidiFlushCount() const { return midiScheduled.flushCount(); }
    int getMidiCursorPosition() const { return midiScheduled.cursorPosition(); }
    void setSlidesMidiEnabled(bool enabled) { midiScheduled.setSendEnabled(enabled); }
    int getOutputChannelCount()const{return outputChannelCount;}
    bool routingReady()const{return routeReady;}
    bool isStereoFallback()const{return stereoFallback;}
    bool isIemReady()const{return iemReady;}
    bool isNextReady()const{return preloadedNextIndex>=0;}
    int nextSongIndex()const{return preloadedNextIndex;}
    juce::String getPadKey() const { return padKey; }
    void setPad(bool enabled) { if(!padGate||!padGain)return;if(enabled){padTransport->setPosition(0);padGate->setOpen(true);padGain->setGain(1.0f,0.35);}else padGain->setGain(0.0f,0.35); }
    void setMusic(bool enabled) { musicEnabled=enabled;applyStemMix(0.03); }
    void setClick(bool enabled) { clickGate.setOpen(enabled); }
    void setCue(bool enabled) { cueGate.setOpen(enabled); }
    bool moveCue(const std::string& targetRegionId,double seconds){return seconds>=0&&cueScheduled.moveEvent(targetRegionId,seconds,outputSampleRate);}
    void setBusGain(const std::string& bus,float gain){gain=juce::jlimit(0.0f,maxMixerFader,gain);if(bus=="music"){musicBusGain=gain;applyStemMix(0.03);}else if(bus=="click"){clickBusGain=gain;applyAuxMix();}else if(bus=="cue"){cueBusGain=gain;applyAuxMix();}else if(bus=="pad"){padBusGain=gain;applyAuxMix();}}
    bool setMixerChannel(int index,float gain,bool muted,bool solo,bool iem){const auto count=static_cast<int>(stemGains.size())+3;if(index<0||index>=count)return false;gain=juce::jlimit(0.0f,maxMixerFader,gain);if(index<static_cast<int>(stemGains.size())){stemFaders[index]=gain;stemMuted[index]=muted;stemSolo[index]=solo;stemIem[index]=iem;stemRoutes[index]->setIemEnabled(iem);}else{const auto aux=index-static_cast<int>(stemGains.size());auxFaders[aux]=gain;auxMuted[aux]=muted;auxSolo[aux]=solo;auxIem[aux]=iem;if(aux==0)clickRoute.setIemEnabled(iem);else if(aux==1)cueRoute.setIemEnabled(iem);else if(padRoute)padRoute->setIemEnabled(iem);}applyStemMix(0.03);applyAuxMix();return true;}
    void setMasterGain(float gain){masterGain.setGain(mixerFaderToGain(gain)*globalOutputTrimGain,0.03);}
    std::vector<float> mixerPeaks()const{std::vector<float> result;result.reserve(stemGains.size()+3);for(const auto& source:stemGains)result.push_back(source->getPeakLevel());result.push_back(clickGain.getPeakLevel());result.push_back(cueGain.getPeakLevel());result.push_back(padMix?padMix->getPeakLevel():0.0f);return result;}
    float masterPeak()const{return masterGain.getPeakLevel();}
    void panic() { panicAttenuation=0.0f;applyStemMix(0.15);setPad(true);scheduledCueGate.setOpen(false); }
    bool announceRecovery(const std::string& targetRegionId,double atSeconds,double repeatAtSeconds) { const auto found=recoveryCues.find(targetRegionId);if(found==recoveryCues.end())return false;scheduledCueGate.setOpen(false);recoveryCue.schedule(found->second.get(),static_cast<juce::int64>(std::llround(atSeconds*outputSampleRate)));if(repeatAtSeconds>=0&&repeatCue)repeatCueSource.schedule(repeatCue.get(),static_cast<juce::int64>(std::llround(repeatAtSeconds*outputSampleRate)));else repeatCueSource.stop();return true; }
    void cancelTransition() { recoveryCue.stop();repeatCueSource.stop();scheduledCueGate.setOpen(true); }
    void recover() { recoveryCue.stop();scheduledCueGate.setOpen(true);panicAttenuation=1.0f;applyStemMix(0.6);if(padGain)padGain->setGain(0.0f,0.8); }
    float musicGainTarget() const { return musicBusGain*panicAttenuation; }
    float padGainTarget() const { return padGain?padGain->getTargetGain():0.0f; }
    bool cueIsOpen() const { return scheduledCueGate.isOpen(); }
    int recoveryCueTriggers() const { return recoveryCue.triggerCount(); }
    ~ArmedSetEngine() {
        for (auto& x:transports) x->stop();
        if(padTransport)padTransport->stop();
        deviceManager.removeAudioCallback(&player);
        player.setSource(nullptr);
        mixer.removeAllInputs();cueMixer.removeAllInputs();
        for(auto& task:cleanupTasks)if(task.valid())task.get();
        readAheadThread.stopThread(2000);
    }
private:
    bool anyMixerSolo()const{if(std::any_of(stemSolo.begin(),stemSolo.end(),[](bool value){return value;}))return true;return auxSolo[0]||auxSolo[1]||auxSolo[2];}
    void applyStemMix(double rampSeconds){const auto anySolo=anyMixerSolo();for(size_t index=0;index<stemGains.size();++index){const auto audible=musicEnabled&&!stemMuted[index]&&(!anySolo||stemSolo[index]);stemGains[index]->setGain(audible?mixerFaderToGain(stemFaders[index])*mixerFaderToGain(musicBusGain)*panicAttenuation:0.0f,rampSeconds);}}
    void applyAuxMix(){const auto anySolo=anyMixerSolo();const auto factor=[&](int index,float busGain){return !auxMuted[index]&&(!anySolo||auxSolo[index])?mixerFaderToGain(auxFaders[index])*mixerFaderToGain(busGain):0.0f;};clickGain.setGain(factor(0,clickBusGain),0.03);cueGain.setGain(factor(1,cueBusGain),0.03);if(padMix)padMix->setGain(factor(2,padBusGain),0.03);}
    juce::AudioFormatManager formats;
    juce::AudioDeviceManager deviceManager;
    juce::MixerAudioSource mixer, cueMixer;
    GainRampAudioSource masterGain { mixer };
    TransportGate gate { masterGain };
    juce::AudioSourcePlayer player;
    juce::TimeSliceThread readAheadThread { "Playback read-ahead" };
    std::vector<std::unique_ptr<juce::AudioFormatReaderSource>> readers;
    std::vector<std::unique_ptr<juce::AudioTransportSource>> transports;
    std::vector<std::unique_ptr<GainRampAudioSource>> stemGains;
    std::vector<std::unique_ptr<RoutedAudioSource>> stemRoutes;
    std::vector<float> stemFaders;std::vector<bool> stemMuted,stemSolo,stemIem;
    float musicBusGain=1.0f,clickBusGain=1.0f,cueBusGain=1.0f,padBusGain=1.0f,panicAttenuation=1.0f;bool musicEnabled=true;
    float auxFaders[3]{1.0f,1.0f,1.0f};bool auxMuted[3]{false,false,false},auxSolo[3]{false,false,false},auxIem[3]{false,false,false};
    std::vector<std::unique_ptr<juce::AudioFormatReaderSource>> retiredReaders;
    std::vector<std::unique_ptr<juce::AudioTransportSource>> retiredTransports;
    std::vector<std::future<void>> cleanupTasks;
    double deviceOpenMs=0, armMs=0,lastResetMs=0,lastStemMs=0,lastLiveMs=0;
    double outputSampleRate=0;int outputChannelCount=0;bool routeReady=false,iemReady=false,stereoFallback=false;
    bool playing=false;
    int clickEventCount=0, cueEventCount=0;
    juce::String padKey;
    ScheduledAudioSource clickScheduled, cueScheduled;RecoveryCueSource recoveryCue,repeatCueSource;ScheduledMidiSource midiScheduled;GainRampAudioSource clickGain{clickScheduled},cueGain{cueMixer};
    TransportGate clickGate { clickGain }, scheduledCueGate { cueScheduled }, cueGate { cueGain };RoutedAudioSource clickRoute{clickGate,1,18},cueRoute{cueGate,1,19};
    std::unique_ptr<juce::AudioFormatReaderSource> padReader;
    std::unique_ptr<juce::AudioTransportSource> padTransport;
    std::unique_ptr<GainRampAudioSource> padGain,padMix;
    std::unique_ptr<TransportGate> padGate;
    std::unique_ptr<RoutedAudioSource> padRoute;

    std::shared_ptr<juce::AudioBuffer<float>> loadScheduledAsset(const juce::String& path) {
        const auto key=path.toStdString(); if(auto found=scheduledAssets.find(key);found!=scheduledAssets.end())return found->second;
        std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(juce::File(path)));
        if(!reader) throw std::runtime_error("Cannot decode scheduled asset: "+key);
        juce::AudioBuffer<float> source(static_cast<int>(reader->numChannels),static_cast<int>(reader->lengthInSamples));
        reader->read(&source,0,source.getNumSamples(),0,true,true);
        const auto targetLength=static_cast<int>(std::ceil(source.getNumSamples()*outputSampleRate/reader->sampleRate));
        auto target=std::make_shared<juce::AudioBuffer<float>>(source.getNumChannels(),targetLength);
        const auto ratio=reader->sampleRate/outputSampleRate;
        for(int channel=0;channel<source.getNumChannels();++channel)for(int i=0;i<targetLength;++i){const auto p=i*ratio;const auto a=juce::jlimit(0,source.getNumSamples()-1,static_cast<int>(p));const auto b=juce::jmin(a+1,source.getNumSamples()-1);const auto f=static_cast<float>(p-a);target->setSample(channel,i,source.getSample(channel,a)*(1-f)+source.getSample(channel,b)*f);}
        scheduledAssets.emplace(key,target); return target;
    }
    std::unordered_map<std::string,std::shared_ptr<juce::AudioBuffer<float>>> scheduledAssets;
    std::unordered_map<std::string,std::shared_ptr<juce::AudioBuffer<float>>> recoveryCues;
    std::shared_ptr<juce::AudioBuffer<float>> repeatCue;
    juce::String midiOutputName,midiWarning;
    bool midiOverrideSet=false,midiOverrideEnabled=false;juce::String midiOverrideName;
    bool midiInputOverrideSet=false,midiInputOverrideEnabled=false;juce::String midiInputOverrideName;MidiInputCapture midiInputCapture;
    bool audioOverrideSet=false;juce::String audioOverrideType,audioOverrideName;int configuredOutputCount=0;std::vector<int> stemOutputs,stemChannels;int clickOutput=18,clickChannels=1,cueOutput=19,cueChannels=1,padOutput=20,padChannels=1,iemOutput=30,iemChannels=1;
    juce::File armedManifestFile;int preloadedNextIndex=-1;std::vector<std::unique_ptr<juce::AudioFormatReaderSource>> preloadedReaders;std::vector<std::unique_ptr<juce::AudioTransportSource>> preloadedTransports;std::unique_ptr<juce::AudioFormatReaderSource> preloadedPadReader;std::unique_ptr<juce::AudioTransportSource> preloadedPadTransport;

    void resetSong(){gate.setOpen(false);playing=false;mixer.removeAllInputs();cueMixer.removeAllInputs();stemRoutes.clear();stemGains.clear();stemFaders.clear();stemMuted.clear();stemSolo.clear();stemIem.clear();for(auto& transport:transports)retiredTransports.push_back(std::move(transport));for(auto& reader:readers)retiredReaders.push_back(std::move(reader));transports.clear();readers.clear();padRoute.reset();padGate.reset();padMix.reset();padGain.reset();if(padTransport)retiredTransports.push_back(std::move(padTransport));if(padReader)retiredReaders.push_back(std::move(padReader));clickScheduled.clearEvents();cueScheduled.clearEvents();midiScheduled.clearEvents();recoveryCue.stop();repeatCueSource.stop();recoveryCues.clear();repeatCue.reset();clickEventCount=0;cueEventCount=0;padKey={};gate.setPositionSamples(0);masterGain.setGain(globalOutputTrimGain);for(int index=0;index<3;++index){auxFaders[index]=1;auxMuted[index]=false;auxSolo[index]=false;auxIem[index]=false;}clickRoute.setIemEnabled(false);cueRoute.setIemEnabled(false);}
    void cleanupRetired(){if(retiredTransports.empty())return;auto oldTransports=std::move(retiredTransports);auto oldReaders=std::move(retiredReaders);cleanupTasks.erase(std::remove_if(cleanupTasks.begin(),cleanupTasks.end(),[](auto& task){return task.wait_for(std::chrono::seconds(0))==std::future_status::ready&&(task.get(),true);}),cleanupTasks.end());cleanupTasks.push_back(std::async(std::launch::async,[transports=std::move(oldTransports),readers=std::move(oldReaders)]()mutable{for(auto& transport:transports){transport->stop();transport->setSource(nullptr);}transports.clear();readers.clear();}));}
    void preloadNext(const juce::var& parsed,int index){preloadedReaders.clear();preloadedTransports.clear();preloadedPadReader.reset();preloadedPadTransport.reset();preloadedNextIndex=-1;const auto songs=parsed.getDynamicObject()->getProperty("songs");if(!songs.isArray()||index<0||index>=songs.getArray()->size())return;const auto song=(*songs.getArray())[index];if(!song.isObject())return;const auto stems=song.getDynamicObject()->getProperty("stems");if(!stems.isArray()||stems.getArray()->isEmpty())return;for(const auto& stem:*stems.getArray()){if(!stem.isObject())return;auto raw=std::unique_ptr<juce::AudioFormatReader>(formats.createReaderFor(juce::File(stem.getDynamicObject()->getProperty("sourcePath").toString())));if(!raw)return;auto reader=std::make_unique<juce::AudioFormatReaderSource>(raw.release(),true);auto transport=std::make_unique<juce::AudioTransportSource>();transport->setSource(reader.get(),32768,&readAheadThread,reader->getAudioFormatReader()->sampleRate,2);transport->start();preloadedReaders.push_back(std::move(reader));preloadedTransports.push_back(std::move(transport));}const auto assets=song.getDynamicObject()->getProperty("liveAssets");if(assets.isObject()){const auto* object=assets.getDynamicObject();const auto click=object->getProperty("click");if(click.isObject()){loadScheduledAsset(click.getDynamicObject()->getProperty("regularPath").toString());loadScheduledAsset(click.getDynamicObject()->getProperty("accentPath").toString());}const auto cues=object->getProperty("cues");if(cues.isArray())for(const auto& cue:*cues.getArray())if(cue.isObject())loadScheduledAsset(cue.getDynamicObject()->getProperty("audioPath").toString());const auto repeat=object->getProperty("repeatCuePath").toString();if(repeat.isNotEmpty())loadScheduledAsset(repeat);const auto pad=object->getProperty("pad");if(pad.isObject()){auto raw=std::unique_ptr<juce::AudioFormatReader>(formats.createReaderFor(juce::File(pad.getDynamicObject()->getProperty("audioPath").toString())));if(raw){preloadedPadReader=std::make_unique<juce::AudioFormatReaderSource>(raw.release(),true);preloadedPadTransport=std::make_unique<juce::AudioTransportSource>();preloadedPadTransport->setSource(preloadedPadReader.get(),32768,&readAheadThread,preloadedPadReader->getAudioFormatReader()->sampleRate,2);preloadedPadTransport->setLooping(true);preloadedPadTransport->start();}}}if(!preloadedPadReader){preloadedReaders.clear();preloadedTransports.clear();return;}preloadedNextIndex=index;}
};
}

int main(int argc, char* argv[]) {
    juce::ScopedJuceInitialiser_GUI init;
    if(argc>=2&&std::string(argv[1])=="--list-midi"){for(const auto& device:juce::MidiOutput::getAvailableDevices())std::cout<<device.name<<'\n';return 0;}
    if(argc>=2&&std::string(argv[1])=="--list-midi-inputs"){for(const auto& device:juce::MidiInput::getAvailableDevices())std::cout<<device.name<<'\n';return 0;}
    if(argc>=3&&std::string(argv[1])=="--test-midi-output"){const juce::String requested(argv[2]);for(const auto& device:juce::MidiOutput::getAvailableDevices())if(device.name==requested){auto output=juce::MidiOutput::openDevice(device.identifier);if(output){std::cout<<"MIDI_OUTPUT_READY name=\""<<device.name<<"\"\n";return 0;}std::cerr<<"MIDI output could not be opened\n";return 5;}std::cerr<<"MIDI output not found\n";return 6;}
    if(argc>=4&&std::string(argv[1])=="--send-midi-output"){const juce::String requested(argv[2]);std::unique_ptr<juce::MidiOutput> output;for(const auto& device:juce::MidiOutput::getAvailableDevices())if(device.name==requested){output=juce::MidiOutput::openDevice(device.identifier);break;}if(!output){std::cerr<<"MIDI output not found or unavailable\n";return 6;}std::vector<juce::uint8> bytes;for(int index=3;index<argc;++index){const auto value=std::stoi(argv[index],nullptr,16);if(value<0||value>255){std::cerr<<"Invalid MIDI byte\n";return 8;}bytes.push_back(static_cast<juce::uint8>(value));}for(size_t offset=0;offset<bytes.size();){const auto status=bytes[offset];if(status<0x80){std::cerr<<"MIDI stream must begin with a status byte\n";return 8;}const auto high=status&0xf0;const size_t size=(high==0xc0||high==0xd0)?2u:3u;if(offset+size>bytes.size()){std::cerr<<"Incomplete MIDI message\n";return 8;}output->sendMessageNow(juce::MidiMessage(bytes.data()+offset,static_cast<int>(size)));offset+=size;}std::cout<<"MIDI_OUTPUT_SENT name=\""<<requested<<"\" bytes="<<bytes.size()<<"\n";return 0;}
    if(argc>=2&&std::string(argv[1])=="--list-audio-devices"){juce::AudioDeviceManager manager;manager.initialise(0,0,nullptr,true);for(auto* type:manager.getAvailableDeviceTypes()){type->scanForDevices();for(const auto& name:type->getDeviceNames(false)){std::unique_ptr<juce::AudioIODevice> device(type->createDevice(name,{}));std::cout<<type->getTypeName()<<'\t'<<name<<'\t'<<(device?device->getOutputChannelNames().size():0)<<'\n';}}return 0;}
    if (argc < 2) { std::cerr << "Usage: PlaybackEngineProbe <confirmed-set.json> [--interactive]\n"; return 2; }
    ArmedSetEngine engine;
    juce::String audioType,audioName;std::vector<int> stemOutputs,stemChannels;int clickOutput=19,clickChannels=1,cueOutput=20,cueChannels=1,padOutput=21,padChannels=1,iemOutput=31,iemChannels=1,outputCount=0;for(int index=2;index<argc;++index){const auto argument=std::string(argv[index]);if(argument=="--disable-midi")engine.setMidiOutputOverride({},false);else if(argument=="--midi-output"&&index+1<argc)engine.setMidiOutputOverride(argv[++index],true);else if(argument=="--midi-input"&&index+1<argc)engine.setMidiInputOverride(argv[++index],true);else if(argument=="--disable-midi-input")engine.setMidiInputOverride({},false);else if(argument=="--audio-device-type"&&index+1<argc)audioType=argv[++index];else if(argument=="--audio-device-name"&&index+1<argc)audioName=argv[++index];else if(argument=="--output-count"&&index+1<argc)outputCount=std::stoi(argv[++index]);else if(argument=="--stem-output"&&index+1<argc)stemOutputs.push_back(std::stoi(argv[++index]));else if(argument=="--stem-channels"&&index+1<argc)stemChannels.push_back(std::stoi(argv[++index]));else if(argument=="--click-output"&&index+1<argc)clickOutput=std::stoi(argv[++index]);else if(argument=="--click-channels"&&index+1<argc)clickChannels=std::stoi(argv[++index]);else if(argument=="--cue-output"&&index+1<argc)cueOutput=std::stoi(argv[++index]);else if(argument=="--cue-channels"&&index+1<argc)cueChannels=std::stoi(argv[++index]);else if(argument=="--pad-output"&&index+1<argc)padOutput=std::stoi(argv[++index]);else if(argument=="--pad-channels"&&index+1<argc)padChannels=std::stoi(argv[++index]);else if(argument=="--iem-output"&&index+1<argc)iemOutput=std::stoi(argv[++index]);else if(argument=="--iem-channels"&&index+1<argc)iemChannels=std::stoi(argv[++index]);}if(audioType.isNotEmpty()&&audioName.isNotEmpty())engine.setAudioDeviceOverride(audioType,audioName);engine.setOutputChannelCount(outputCount);if(stemChannels.empty())stemChannels.assign(stemOutputs.size(),1);if(stemChannels.size()!=stemOutputs.size()){std::cerr<<"Every stem output requires a channel width\n";return 7;}for(size_t index=0;index<stemOutputs.size();++index)if(stemOutputs[index]<0||stemOutputs[index]>32||(stemOutputs[index]>0&&stemOutputs[index]+stemChannels[index]-1>32)||(stemChannels[index]!=1&&stemChannels[index]!=2)){std::cerr<<"Stem routing must be unassigned or fit outputs 1-32\n";return 7;}const auto validRoute=[](int output,int width){return (width==1||width==2)&&output>=0&&output<=32&&(output==0||output+width-1<=32);};if(!validRoute(clickOutput,clickChannels)||!validRoute(cueOutput,cueChannels)||!validRoute(padOutput,padChannels)||!validRoute(iemOutput,iemChannels)){std::cerr<<"Routing output is outside 0-32\n";return 7;}for(auto& output:stemOutputs)--output;engine.setRouting(stemOutputs,stemChannels,clickOutput-1,clickChannels,cueOutput-1,cueChannels,padOutput-1,padChannels,iemOutput-1,iemChannels);
    if (const auto error=engine.openDefaultDevice(); error.isNotEmpty()) { std::cerr << "Audio device error: " << error << '\n'; return 3; }
    const juce::File manifest(argv[1]);
    int songIndex=0;
    for(int index=2;index+1<argc;++index)if(std::string(argv[index])=="--song-index")songIndex=std::stoi(argv[index+1]);
    if (const auto result=engine.arm(manifest,songIndex); result.failed()) { std::cerr << "Arm error: " << result.getErrorMessage() << '\n'; return 4; }
    std::cout << "READY device_open_ms=" << engine.getDeviceOpenMs() << " arm_ms=" << engine.getArmMs() << " stems=" << engine.stemCount() << " click_events=" << engine.getClickEventCount() << " cue_events=" << engine.getCueEventCount() << " pad_key=" << engine.getPadKey() << " midi_events=" << engine.getMidiEventCount() << " midi_enabled=" << (engine.midiEnabled()?1:0) << " midi_input_enabled=" << (engine.midiInputEnabled()?1:0) << " output_channels=" << engine.getOutputChannelCount() << " routing_ready=" << (engine.routingReady()?1:0) << " iem_ready=" << (engine.isIemReady()?1:0) << " stereo_fallback=" << (engine.isStereoFallback()?1:0) << " next_ready=" << (engine.isNextReady()?1:0) << " next_index=" << engine.nextSongIndex() << " midi_warning=\"" << engine.getMidiWarning() << "\"\n" << std::flush;
    if (argc < 3 || std::string(argv[2]) != "--interactive") return 0;
    std::cout << "Commands: play, pause, stop, seek <seconds>, quit\n";
    for (std::string command; std::cin >> command;) {
        if (command=="play") std::cout << "PLAY command_ms=" << engine.play() << '\n';
        else if (command=="pause") std::cout << "PAUSE command_ms=" << engine.pause() << '\n';
        else if (command=="stop") std::cout << "STOP command_ms=" << engine.stop() << '\n';
        else if (command=="seek") { double s=0; std::cin>>s; std::cout << "SEEK command_ms=" << engine.seek(s) << '\n'; }
        else if (command=="status") {engine.synchronizeTransportEnd();std::cout << "STATE state=" << engine.stateName() << " position_seconds=" << engine.positionSeconds() << " start_latency_ms=" << engine.startLatencyMs() << " music_gain_target=" << engine.musicGainTarget() << " pad_gain_target=" << engine.padGainTarget() << " cue_open=" << (engine.cueIsOpen()?1:0) << " recovery_cue_triggers=" << engine.recoveryCueTriggers() << " midi_dispatched=" << engine.getMidiDispatchedEventCount() << " midi_flushes=" << engine.getMidiFlushCount() << " midi_cursor=" << engine.getMidiCursorPosition() << '\n';const auto peaks=engine.mixerPeaks();std::cout<<"METERS master="<<engine.masterPeak()<<" channels=";for(size_t index=0;index<peaks.size();++index){if(index)std::cout<<',';std::cout<<peaks[index];}std::cout<<'\n';for(const auto& event:engine.takeMidiInputEvents())std::cout<<"MIDI_IN status="<<event.status<<" data1="<<event.data1<<" data2="<<event.data2<<'\n';}
        else if (command=="pad_on") { engine.setPad(true); std::cout << "PAD state=on\n"; }
        else if (command=="pad_off") { engine.setPad(false); std::cout << "PAD state=off\n"; }
        else if (command=="music_on") { engine.setMusic(true); std::cout << "MUSIC state=on\n"; }
        else if (command=="music_off") { engine.setMusic(false); std::cout << "MUSIC state=off\n"; }
        else if (command=="click_on") { engine.setClick(true); std::cout << "CLICK state=on\n"; }
        else if (command=="click_off") { engine.setClick(false); std::cout << "CLICK state=off\n"; }
        else if (command=="cue_on") { engine.setCue(true); std::cout << "CUE state=on\n"; }
        else if (command=="cue_off") { engine.setCue(false); std::cout << "CUE state=off\n"; }
        else if(command=="cue_time"){std::string target;double seconds=0;std::cin>>target>>seconds;if(engine.moveCue(target,seconds))std::cout<<"CUE_TIME target="<<target<<" at_seconds="<<seconds<<"\n";else std::cout<<"CUE_TIME_FAILED target="<<target<<"\n";}
        else if(command=="slides_midi_on"){engine.setSlidesMidiEnabled(true);std::cout<<"SLIDES_MIDI state=on\n";}
        else if(command=="slides_midi_off"){engine.setSlidesMidiEnabled(false);std::cout<<"SLIDES_MIDI state=off\n";}
        else if(command=="gain"){std::string bus;float value=1;std::cin>>bus>>value;engine.setBusGain(bus,value);std::cout<<"GAIN bus="<<bus<<" value="<<value<<"\n";}
        else if(command=="mixer_channel"){int index=0,muted=0,solo=0,iem=0;float value=1;std::cin>>index>>value>>muted>>solo>>iem;if(engine.setMixerChannel(index,value,muted!=0,solo!=0,iem!=0))std::cout<<"MIXER_CHANNEL index="<<index<<" value="<<value<<" muted="<<muted<<" solo="<<solo<<" iem="<<iem<<"\n";else std::cout<<"MIXER_CHANNEL_FAILED index="<<index<<"\n";}
        else if(command=="master_gain"){float value=1;std::cin>>value;engine.setMasterGain(value);std::cout<<"MASTER_GAIN value="<<value<<"\n";}
        else if(command=="select_song"){int index=0;std::cin>>index;const auto result=engine.selectSong(index);if(result.failed())std::cout<<"SELECT_FAILED index="<<index<<" error=\""<<result.getErrorMessage()<<"\"\n";else std::cout<<"SELECTED index="<<index<<" device_open_ms="<<engine.getDeviceOpenMs()<<" arm_ms="<<engine.getArmMs()<<" stems="<<engine.stemCount()<<" click_events="<<engine.getClickEventCount()<<" cue_events="<<engine.getCueEventCount()<<" pad_key="<<engine.getPadKey()<<" midi_events="<<engine.getMidiEventCount()<<" midi_enabled="<<(engine.midiEnabled()?1:0)<<" output_channels="<<engine.getOutputChannelCount()<<" routing_ready="<<(engine.routingReady()?1:0)<<" iem_ready="<<(engine.isIemReady()?1:0)<<" stereo_fallback="<<(engine.isStereoFallback()?1:0)<<" next_ready="<<(engine.isNextReady()?1:0)<<" next_index="<<engine.nextSongIndex()<<" reset_ms="<<engine.getResetMs()<<" stem_ms="<<engine.getStemMs()<<" live_ms="<<engine.getLiveMs()<<"\n";}
        else if(command=="select_manifest"){int index=0;std::string path;std::cin>>index>>std::quoted(path);const auto result=engine.arm(juce::File(path),index);if(result.failed())std::cout<<"SELECT_FAILED index="<<index<<" error=\""<<result.getErrorMessage()<<"\"\n";else std::cout<<"SELECTED index="<<index<<" device_open_ms="<<engine.getDeviceOpenMs()<<" arm_ms="<<engine.getArmMs()<<" stems="<<engine.stemCount()<<" click_events="<<engine.getClickEventCount()<<" cue_events="<<engine.getCueEventCount()<<" pad_key="<<engine.getPadKey()<<" midi_events="<<engine.getMidiEventCount()<<" midi_enabled="<<(engine.midiEnabled()?1:0)<<" output_channels="<<engine.getOutputChannelCount()<<" routing_ready="<<(engine.routingReady()?1:0)<<" iem_ready="<<(engine.isIemReady()?1:0)<<" stereo_fallback="<<(engine.isStereoFallback()?1:0)<<" next_ready="<<(engine.isNextReady()?1:0)<<" next_index="<<engine.nextSongIndex()<<" reset_ms="<<engine.getResetMs()<<" stem_ms="<<engine.getStemMs()<<" live_ms="<<engine.getLiveMs()<<"\n";}
        else if (command=="panic") { engine.panic(); std::cout << "PANIC state=safe\n"; }
        else if (command=="announce_recovery") { std::string target;double at=0,repeatAt=-1;std::cin>>target>>at>>repeatAt;if(engine.announceRecovery(target,at,repeatAt))std::cout << "RECOVERY_CUE state=armed target=" << target << " at_seconds=" << at << " repeat_at_seconds=" << repeatAt << "\n";else std::cout << "RECOVERY_CUE state=missing target=" << target << "\n"; }
        else if (command=="cancel_transition") { engine.cancelTransition();std::cout << "TRANSITION state=cancelled\n"; }
        else if (command=="recover") { engine.recover();std::cout << "RECOVER state=playing\n"; }
        else if (command=="quit") break;
        std::cout << std::flush;
    }
}
