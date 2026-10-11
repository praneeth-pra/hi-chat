-- Run from the repository root with Lua 5.3+: lua scripts/hammerspoon/test-recommendation-shortcuts.lua
-- Execute the actual script's recommendation tap against synthetic macOS events.
local sent = {}
local callback
hs = {
  keycodes = { map = { left = 123, right = 124, home = 115, ["end"] = 119, fn = 63 } },
  timer = { doAfter = function(_, fn) fn() end },
  eventtap = { event = { types = { keyDown = 1, flagsChanged = 2 }, properties = { keyboardEventAutorepeat = 1 } } },
}
hs.eventtap.new = function(_, fn)
  callback = fn
  return { start = function() end }
end
local function toggle(key, mods) sent[#sent + 1] = { key = key, mods = mods } end
local source = SCRIPT_SOURCE
if not source then
  local sourceFile = assert(io.open("scripts/hammerspoon/jan-remote.lua", "r"))
  source = sourceFile:read("*a")
  sourceFile:close()
end
local start = assert(source:find('local LEFT, RIGHT', 1, true))
local finish = assert(source:find('-- Left Control on its own', start, true))
local block = source:sub(start, finish - 1)
-- Keep toggle as a lexical binding, matching its location in the real script.
assert(load('local toggle = ...\n' .. block))(toggle)
local function event(kind, key, flags, repeatKey)
  return { getType = function() return kind end, getKeyCode = function() return key end,
    getFlags = function() return flags or {} end, getProperty = function() return repeatKey and 1 or 0 end }
end
local function press(key, flags, repeatKey) return callback(event(1, key, flags, repeatKey)) end
-- macOS can set secondary-fn on plain arrows: these must still pass through.
assert(press(123, { fn = true }) == false)
assert(press(124, { fn = true }) == false)
assert(press(115, { fn = true }) == false)
assert(press(119, { fn = true }) == false)
assert(#sent == 0)
callback(event(2, 63, { fn = true }))
assert(press(124, { fn = true }) == true)
assert(sent[1].key == "f15" and sent[1].mods[1] == "shift")
assert(press(123, { fn = true }) == true)
assert(sent[2].key == "f18" and sent[2].mods[1] == "shift")
assert(press(124, { fn = true }, true) == true and #sent == 2)
assert(press(124, { fn = true, cmd = true }) == false and #sent == 2)
callback(event(2, 63, {}))
assert(press(124, { fn = true }) == false and #sent == 2)
print("Recommendation shortcuts passed: plain arrows pass through; physical fn is required.")
