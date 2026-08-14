#define NOMINMAX
#include <windows.h>
#include <objbase.h>

#include "iasiodrv.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <iostream>
#include <limits>
#include <string_view>
#include <thread>
#include <vector>

namespace {
std::atomic<std::uint64_t> callbacks {}, firstSample {}, lastSample {};
IASIO* driver {};
std::vector<ASIOBufferInfo> buffers;
long blockFrames {};
long bytesPerSample { 4 };

std::uint64_t value(ASIOSamples samples) noexcept {
#if NATIVE_INT64
    return static_cast<std::uint64_t>(samples);
#else
    return (static_cast<std::uint64_t>(samples.hi) << 32) | samples.lo;
#endif
}

void process(long index) noexcept {
    for (auto& buffer : buffers) if (!buffer.isInput && buffer.buffers[index]) std::memset(buffer.buffers[index], 0, static_cast<std::size_t>(blockFrames) * bytesPerSample);
    callbacks.fetch_add(1); if (driver) driver->outputReady();
}

void __stdcall bufferSwitch(long index, ASIOBool) { process(index); }
ASIOTime* __stdcall bufferSwitchTimeInfo(ASIOTime* time, long index, ASIOBool) {
    if (time && (time->timeInfo.flags & kSamplePositionValid)) { const auto sample = value(time->timeInfo.samplePosition); if (callbacks.load() == 0) firstSample.store(sample); lastSample.store(sample); }
    process(index); return nullptr;
}
void __stdcall sampleRateChanged(ASIOSampleRate) {}
long __stdcall asioMessage(long selector, long value, void*, double*) {
    if (selector == kAsioSelectorSupported) return value == kAsioResetRequest || value == kAsioResyncRequest || value == kAsioLatenciesChanged || value == kAsioEngineVersion || value == kAsioSupportsTimeInfo;
    if (selector == kAsioEngineVersion) return 2;
    if (selector == kAsioSupportsTimeInfo) return 1;
    return 0;
}
}

int main(int argc, char** argv) {
    const auto seconds = argc > 1 ? std::max(1, std::atoi(argv[1])) : 30;
    const auto fullDuplex = argc > 2 && std::string_view(argv[2]) == "full";
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 2;
    CLSID clsid {}; if (FAILED(CLSIDFromString(L"{B5DEF3F2-B191-4f8d-9A67-A77402A6D3D8}", &clsid))) return 3;
    if (FAILED(CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER, clsid, reinterpret_cast<void**>(&driver))) || !driver) { std::cerr << "NATIVE_ASIO_OPEN_FAILED\n"; CoUninitialize(); return 4; }
    if (!driver->init(GetDesktopWindow())) { std::cerr << "NATIVE_ASIO_INIT_FAILED\n"; driver->Release(); CoUninitialize(); return 5; }
    ASIOSampleRate rate {}; driver->getSampleRate(&rate); if (rate != 48000.0 && driver->setSampleRate(48000.0) != ASE_OK) { std::cerr << "NATIVE_ASIO_RATE_FAILED rate=" << rate << '\n'; driver->Release(); CoUninitialize(); return 6; } driver->getSampleRate(&rate);
    long inputs {}, outputs {}, minimum {}, maximum {}, preferred {}, granularity {}; driver->getChannels(&inputs, &outputs); driver->getBufferSize(&minimum, &maximum, &preferred, &granularity); blockFrames = preferred;
    const auto activeInputs = fullDuplex ? std::min<long>(32, inputs) : 0, activeOutputs = std::min<long>(32, outputs); buffers.resize(static_cast<std::size_t>(activeInputs + activeOutputs));
    for (long channel = 0; channel < activeInputs + activeOutputs; ++channel) { const auto isInput = channel < activeInputs; auto& buffer = buffers[static_cast<std::size_t>(channel)]; buffer.isInput = isInput ? ASIOTrue : ASIOFalse; buffer.channelNum = isInput ? channel : channel - activeInputs; buffer.buffers[0] = buffer.buffers[1] = nullptr; ASIOChannelInfo info {}; info.channel = buffer.channelNum; info.isInput = buffer.isInput; if (driver->getChannelInfo(&info) != ASE_OK || (info.type != ASIOSTInt24LSB && info.type != ASIOSTInt32LSB && info.type != ASIOSTInt32LSB24)) { std::cerr << "NATIVE_ASIO_UNSUPPORTED_FORMAT channel=" << channel << " type=" << info.type << '\n'; driver->Release(); CoUninitialize(); return 7; } bytesPerSample = info.type == ASIOSTInt24LSB ? 3 : 4; }
    ASIOCallbacks functions { &bufferSwitch, &sampleRateChanged, &asioMessage, &bufferSwitchTimeInfo };
    const auto activeBufferCount = activeInputs + activeOutputs;
    if (driver->createBuffers(buffers.data(), activeBufferCount, blockFrames, &functions) != ASE_OK) { std::cerr << "NATIVE_ASIO_CREATE_BUFFERS_FAILED\n"; driver->Release(); CoUninitialize(); return 8; }
    for (auto& buffer : buffers) if (!buffer.isInput) for (auto* data : buffer.buffers) if (data) std::memset(data, 0, static_cast<std::size_t>(blockFrames) * bytesPerSample);
    if (driver->start() != ASE_OK) { std::cerr << "NATIVE_ASIO_START_FAILED\n"; driver->disposeBuffers(); driver->Release(); CoUninitialize(); return 9; }
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30); while (callbacks.load() == 0 && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(std::chrono::milliseconds(2));
    const auto baselineCallbacks = callbacks.load(), baselineSample = lastSample.load(); std::uint64_t minimumPerSecond = std::numeric_limits<std::uint64_t>::max(), maximumPerSecond = 0, previous = baselineCallbacks;
    for (int second = 0; second < seconds; ++second) { std::this_thread::sleep_for(std::chrono::seconds(1)); const auto current = callbacks.load(), delta = current - previous; previous = current; minimumPerSecond = std::min(minimumPerSecond, delta); maximumPerSecond = std::max(maximumPerSecond, delta); }
    driver->stop(); const auto totalCallbacks = callbacks.load() - baselineCallbacks, sampleAdvance = lastSample.load() - baselineSample; driver->disposeBuffers(); driver->Release(); driver = nullptr; CoUninitialize();
    std::cout << "NATIVE_ASIO_COMPLETE seconds=" << seconds << " sample_rate=" << rate << " block_frames=" << blockFrames << " inputs=" << activeInputs << " outputs=" << activeOutputs << " callbacks=" << totalCallbacks << " callbacks_per_second_min=" << minimumPerSecond << " callbacks_per_second_max=" << maximumPerSecond << " sample_position_advance=" << sampleAdvance << '\n';
    return 0;
}
