local output_path = reaper.GetResourcePath() .. "/silent-reaper-clock-result.txt"
local _, audio_rate = reaper.GetAudioDeviceInfo("SRATE")
local _, audio_block = reaper.GetAudioDeviceInfo("BSIZE")
local _, audio_mode = reaper.GetAudioDeviceInfo("MODE")
reaper.InsertTrackAtIndex(0, false)
local track = reaper.GetTrack(0, 0)
reaper.SetMediaTrackInfo_Value(track, "B_MUTE", 1)
reaper.CreateNewMIDIItemInProj(track, 0, 60, false)

local launched = reaper.time_precise()
local wall_start = nil
local play_start = nil

local function finish()
  local wall_elapsed = reaper.time_precise() - wall_start
  local play_elapsed = reaper.GetPlayPosition() - play_start
  reaper.OnStopButton()
  local file = io.open(output_path, "w")
  if file then
    file:write(string.format("REAPER_CLOCK_COMPLETE wall_seconds=%.6f transport_seconds=%.6f ratio=%.6f audio_rate=%s audio_block=%s audio_mode=%s\n", wall_elapsed, play_elapsed, play_elapsed / wall_elapsed, audio_rate, audio_block, audio_mode))
    file:close()
  end
end

local function poll()
  local now = reaper.time_precise()
  if not wall_start then
    if now - launched < 5.0 then
      reaper.defer(poll)
      return
    end
    reaper.OnPlayButton()
    if (reaper.GetPlayState() & 1) == 0 then
      local file = io.open(output_path, "w")
      if file then file:write("REAPER_CLOCK_FAILED play_state=" .. reaper.GetPlayState() .. "\n"); file:close() end
      return
    end
    wall_start = now
    play_start = reaper.GetPlayPosition()
  end
  if now - wall_start >= 30.0 then
    finish()
  else
    reaper.defer(poll)
  end
end

poll()
