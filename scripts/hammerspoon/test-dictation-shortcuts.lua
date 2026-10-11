-- Run from the repository root with Lua 5.3+.
local source = SCRIPT_SOURCE
if not source then
  local file = assert(io.open("scripts/hammerspoon/jan-remote.lua", "r"))
  source = file:read("*a")
  file:close()
end
-- Retired keys have no callback/binding, including plain and fn side arrows.
assert(not source:find('recommendationTap', 1, true))
assert(not source:find('toggle("f19")', 1, true))
assert(not source:find('toggle("f18")', 1, true))
local sent, callback = {}, nil
hs = {
  keycodes = { map = { ctrl = 59 } },
  timer = { secondsSinceEpoch = function() return 1 end, doAfter = function(_, fn) fn() end },
  eventtap = { event = { types = { flagsChanged = 1, keyDown = 2, leftMouseDown = 3, rightMouseDown = 4, scrollWheel = 5 } } },
}
hs.eventtap.new = function(_, fn) callback = fn; return { start = function() end } end
local function toggle(key) sent[#sent + 1] = key end
local start = assert(source:find('-- Left Control on its own', 1, true))
local finish = assert(source:find('-- Background typing:', start, true))
assert(load('local toggle = ...\n' .. source:sub(start, finish - 1)))(toggle)
local function event(kind, key, control)
  return { getType = function() return kind end, getKeyCode = function() return key end,
    getFlags = function() return { ctrl = control, containExactly = function(_, flags) return control and flags[1] == 'ctrl' end } end }
end
assert(callback(event(1, 59, true)) == false)
assert(callback(event(1, 59, false)) == false)
assert(#sent == 1 and sent[1] == 'f14')
-- Control combined with another key is not treated as dictation.
callback(event(1, 59, true))
callback(event(2, 42, true))
callback(event(1, 59, false))
assert(#sent == 1)
-- The dictation callback does not respond to Left Option.
callback(event(1, 58, false))
assert(#sent == 1)
print('Dictation shortcuts passed; obsolete Speaker bindings are absent.')
