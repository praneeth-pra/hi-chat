-- Verify the actual send callback, including macOS's fn+Right -> End mapping.
local source = SCRIPT_SOURCE
if not source then local f = assert(io.open('scripts/hammerspoon/jan-remote.lua', 'r')); source = f:read('*a'); f:close() end
local sent, callback = {}, nil
local types = { flagsChanged = 1, keyDown = 2, keyUp = 3 }
hs = {
  keycodes = { map = { ['return'] = 36, padenter = 76, fn = 63, right = 124, ['end'] = 119 } },
  timer = { doAfter = function(_, fn) fn() end },
  eventtap = { event = { types = types, properties = { keyboardEventAutorepeat = 1 } } },
}
hs.eventtap.new = function(_, fn) callback = fn; return { start = function() end } end
local start = assert(source:find('-- fn + Right sends F15', 1, true))
local finish = assert(source:find('-- Left Control on its own', start, true))
assert(load('local toggle = ...\n' .. source:sub(start, finish - 1)))(function(key) sent[#sent + 1] = key end)
local function event(kind, key, flags, repeatKey)
 return { getType = function() return kind end, getKeyCode = function() return key end,
 getFlags = function() return flags or {} end, getProperty = function() return repeatKey and 1 or 0 end }
end
-- Function bits on plain navigation are not proof that physical fn is held.
assert(callback(event(types.keyDown, 124, { fn = true })) == false)
assert(callback(event(types.keyDown, 119, { fn = true })) == false)
callback(event(types.flagsChanged, 63, { fn = true }))
assert(callback(event(types.keyDown, 124, { fn = true })) == true)
assert(#sent == 1 and sent[1] == 'f15')
assert(callback(event(types.keyDown, 124, { fn = true }, true)) == true)
assert(#sent == 1)
assert(callback(event(types.keyUp, 124, { fn = true })) == true)
assert(callback(event(types.keyDown, 119, { fn = true })) == true)
assert(#sent == 2)
callback(event(types.keyUp, 119, { fn = true }))
assert(callback(event(types.keyDown, 36, { fn = true })) == false) -- fn+Return is released
assert(callback(event(types.keyDown, 123, { fn = true })) == false) -- fn+Left is released
assert(callback(event(types.keyDown, 124, { fn = true, shift = true })) == false)
callback(event(types.flagsChanged, 63, {}))
assert(callback(event(types.keyDown, 124)) == false)
assert(#sent == 2)
print('Send shortcut passed: physical fn+Right/End only; no plain arrows, Return or repeat sends.')
