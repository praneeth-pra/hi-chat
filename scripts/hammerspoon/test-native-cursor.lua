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
local exportOK = true
local nativeImage = {}
os.tmpname = function() return '/tmp/native-cursor-test' end
os.remove = function() return true end
hs = {
  execute = function() return '1.25' end,
  osascript = { javascript = function(script)
    assert(script:find('$.NSCursor.arrowCursor', 1, true))
    assert(script:find('cursor.hotSpot', 1, true))
    return exportOK, 'native metadata'
  end },
  json = { decode = function() return { w = 18, h = 24, x = 1, y = 2 } end },
  image = { imageFromPath = function() return nativeImage end },
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
print('Native cursor tests passed: system image, logical size, hotspot, and safe export failure.')
