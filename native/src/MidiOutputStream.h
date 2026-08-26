#pragma once
#include <vector>
#include <utility>
#include <stdexcept>
#include <cstddef>

// Validate the entire stream before opening/sending: a malformed trailing
// message must never cause a partial console update. Running status is not used.
inline std::vector<std::pair<size_t,size_t>> midiOutputMessages(const std::vector<unsigned char>& bytes) {
    if(bytes.size()>4096)throw std::runtime_error("MIDI output stream too large");
    std::vector<std::pair<size_t,size_t>> result;
    for(size_t start=0;start<bytes.size();) {
        const auto status=bytes[start];size_t end=start+1;
        if(status==0xf0) {
            while(end<bytes.size() && bytes[end]<0x80)++end;
            if(end>=bytes.size() || bytes[end]!=0xf7)throw std::runtime_error("Incomplete or invalid MIDI SysEx");
            ++end;
        } else {
            if(status<0x80 || status>=0xf0)throw std::runtime_error("Unsupported MIDI status");
            end=start+(((status&0xf0)==0xc0 || (status&0xf0)==0xd0)?2:3);
            if(end>bytes.size())throw std::runtime_error("Incomplete MIDI message");
            for(size_t i=start+1;i<end;++i)if(bytes[i]>=0x80)throw std::runtime_error("Invalid MIDI data byte");
        }
        result.push_back({start,end-start});start=end;
    }
    return result;
}
