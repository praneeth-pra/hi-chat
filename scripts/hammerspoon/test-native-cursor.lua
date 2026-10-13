-- Run from the repository root with Lua 5.3+: lua scripts/hammerspoon/test-native-cursor.lua
local source = SCRIPT_SOURCE
if not source then
  local file = assert(io.open("scripts/hammerspoon/jan-remote.lua", "r"))
  source = file:read("*a")
  file:close()
end
local start = assert(source:find('local DUMMY_CURSOR = true', 1, true))
local finish = assert(source:find('local lastBox', start, true))
local block = source:sub(start, finish - 1) .. '\nreturn showDummy, hideDummy'
local frame, element, deleted
local exportOK, currentOK = true, true
local nativeImage, beamImage = {}, {}
local lastScript
os.tmpname = function() return '/tmp/native-cursor-test' end
os.remove = function() return true end
hs = {
  execute = function() return '1.25' end,
  osascript = { javascript = function(script)
    assert(script:find('cursor.hotSpot', 1, true))
    assert(script:find('"/tmp/native-cursor-test.tiff"', 1, true)) -- export path filled in
    if script:find('$.NSCursor.currentSystemCursor', 1, true) then
      lastScript = 'current'
      return currentOK, 'current metadata'
    end
    assert(script:find('$.NSCursor.arrowCursor', 1, true))
    lastScript = 'arrow'
    return exportOK, 'native metadata'
  end },
  json = { decode = function(text)
    if text == 'current metadata' then return { w = 8, h = 16, x = 4, y = 8 } end
    return { w = 18, h = 24, x = 1, y = 2 }
  end },
  image = { imageFromPath = function()
    return lastScript == 'current' and beamImage or nativeImage
  end },
  printf = function() end,
  canvas = { windowLevels = { cursor = 1 }, new = function(bounds)
    frame = bounds
    return {
      appendElements = function(_, content) element = content end,
      level = function() end, behavior = function() end, show = function() end,
      delete = function() deleted = true end,
    }
  end },
}
local show, hide = assert(load(block))()
-- The dummy copies the pointer's current shape (here an I-beam over text).
show({ x = 100, y = 200 })
assert(frame.w == 10 and frame.h == 20) -- current cursor size times Accessibility scale
assert(frame.x == 95 and frame.y == 190) -- its hotspot stays at the real pointer
assert(element.image == beamImage)
-- If the current shape can't be read, it falls back to the arrow.
currentOK = false
show({ x = 100, y = 200 })
assert(frame.w == 22.5 and frame.h == 30) -- native logical size times Accessibility scale
assert(frame.x == 98.75 and frame.y == 197.5) -- native hotspot remains at the real pointer
assert(element.type == 'image' and element.image == nativeImage)
assert(element.withShadow == nil and element.strokeWidth == nil)
hide()
assert(deleted)
-- A failed native export must not fall back to an oversized approximation.
exportOK, frame = false, nil
show = assert(load(block))()
show({ x = 100, y = 200 })
assert(frame == nil)
print('Native cursor tests passed: current shape, arrow fallback, system image, logical size, hotspot, and safe export failure.')
