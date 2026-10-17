-- Jan remote for Hammerspoon: scroll the chat and dictate
-- Smoothly scrolls the Jan chat window on your external monitor from the
-- keyboard, without moving your mouse there.
--
--   hold fn + two-finger scroll  scrolls Jan instead of the laptop screen,
--                                with the trackpad's normal feel and glide
--   fn + Up / Down          jump to the code block above / below in Jan;
--                           press again to keep stepping through the code
--   fn + Shift + Down / Up  scroll fast (tap for a glide, hold to keep going)
--   Z                       jump to Jan: pointer and cursor go into the prompt box
--   X                       jump back: the pointer returns to where it was last
--                           seen off Jan, and the window there gets focus
--                           (Z and X work independently)
--   fn + Right              send in Jan without leaving the app you're in:
--                           what's typed in the prompt box
--   tap Left Control        dictate in Jan: starts recording your mic; tap
--                           again to stop, transcribe and send it. Control held with
--                           another key or a click works as usual.
--   Escape while dictating  throws the recording away; nothing is sent.
--                           Escape works as usual the rest of the time.
--   tap Left Option         toggle background typing into Jan's prompt box;
--                           the main app stays active. Escape also turns it off.
--                           Return sends the prompt; Shift + Return adds a line.
--                           The pointer moves over to Jan too (a dummy cursor
--                           stays behind); hovering works, and a click or a
--                           drag to select text there is done by Jan itself,
--                           so Safari never becomes the active app; tapping Option
--                           again puts the pointer back. Two-finger scrolling
--                           scrolls Jan while it is on, like holding fn.
--   fn + Left               open a second window that mirrors Jan live; tap
--                           again to switch it to the screen around the pointer
--                           and back. Drag it to move, its corner to resize,
--                           x or fn + Shift + Left to close. Needs Screen
--                           Recording for Hammerspoon.
--                           Build JanMirror.swift (see its top) for a 60 fps
--                           live stream; without it, screenshots are used.
--
-- On a Mac keyboard fn + Up / Down are Page Up / Page Down, so while
-- Hammerspoon runs, those keys no longer reach other apps. Left / Right
-- arrows remain available to the app in front; fn + Left (Home) is the mirror key.
-- Option held with another key retains its normal modifier behavior.
--
-- Settings you may want to change:
local SPEED = 700        -- pixels per second while held
local TAP = 120          -- pixels a quick tap scrolls
local FAST_SPEED = 2000  -- with Shift
local FAST_TAP = 600     -- with Shift
local WARP = false       -- true if scrolling does nothing: the pointer then
                         -- jumps to the chat and back (may flicker)
local FLIP = false       -- true if Down scrolls up on your Mac

local FRAME = 1 / 60
local MAX_SECONDS = 8    -- safety stop if a key release is missed

-- Jan as a Safari web app ("Add to Dock") is its own app named "Jan";
-- otherwise it is a Safari window.
local APPS = { "Jan", "Safari" }
local typingTarget = nil
-- Set once the dummy cursor exists (further down): move the pointer over to
-- Jan when typing turns on, and back when it turns off
local typingPointerOn, typingPointerOff

-- The Jan/Safari window that is not on the laptop's built-in screen
local function chatWindow()
  local fallback
  for _, name in ipairs(APPS) do
    local app = hs.application.get(name)
    if app then
      for _, win in ipairs(app:allWindows()) do
        if win:isStandard() and win:isVisible() then
          local screen = win:screen()
          local screenName = screen and screen:name() or ""
          if not screenName:find("Built%-in") then return win end
          fallback = fallback or win
        end
      end
    end
  end
  return fallback
end

local function post(px, at)
  if FLIP then px = -px end
  local event = hs.eventtap.event.newScrollEvent({ 0, px }, {}, "pixel")
  if WARP then
    local back = hs.mouse.absolutePosition()
    hs.mouse.absolutePosition(at)
    event:post()
    hs.mouse.absolutePosition(back)
  else
    event:location(at)
    event:post()
  end
end

-- The scroll in progress: runs every frame until the key is released and
-- at least a tap's distance has been covered.
local active

local function stop(s)
  s.timer:stop()
  if active == s then active = nil end
end

local function start(dir, speed, tap)
  if active then stop(active) end
  local win = chatWindow()
  if not win then
    print("[jan remote] Jan window not found")
    return
  end
  local f = win:frame()
  local at = { x = f.x + f.w / 2, y = f.y + f.h / 2 }
  local s = { moved = 0, carry = 0, released = false, frames = 0 }
  s.timer = hs.timer.doEvery(FRAME, function()
    local want = speed * FRAME + s.carry
    local px = math.floor(want)
    s.carry = want - px
    if px > 0 then
      post(dir * px, at)
      s.moved = s.moved + px
    end
    s.frames = s.frames + 1
    if (s.released and s.moved >= tap) or s.frames * FRAME > MAX_SECONDS then
      stop(s)
    end
  end)
  active = s
end

local function release()
  if active then active.released = true end
end

local function bind(mods, key, dir, speed, tap)
  hs.hotkey.bind(mods, key, function() start(dir, speed, tap) end, release)
end

-- Negative scrolls the page down
bind({ "shift" }, "pagedown", -1, FAST_SPEED, FAST_TAP)
bind({ "shift" }, "pageup", 1, FAST_SPEED, FAST_TAP)

-- Keys for Jan, sent straight to its window without focusing it:
-- Shift + F16 / F17 (code block above / below) and so on, keys a
-- Mac laptop doesn't have.
local function toggle(key, mods)
  local win = typingTarget and typingTarget.win or chatWindow()
  if not win then
    print("[jan remote] Jan window not found")
    return
  end
  hs.eventtap.keyStroke(mods or {}, key, 20000, win:application())
end

-- fn + Up / Down: the code block above / below
hs.hotkey.bind({}, "pageup", function() toggle("f16", { "shift" }) end)
hs.hotkey.bind({}, "pagedown", function() toggle("f17", { "shift" }) end)

-- fn + Right sends F15 to Jan. Track the physical fn modifier separately:
-- an arrow/End event's function flag alone must never turn plain arrows into hotkeys.
local RETURN, PAD_ENTER = hs.keycodes.map["return"], hs.keycodes.map["padenter"]
local FN_KEY = hs.keycodes.map["fn"] or 63
local RIGHT, END_KEY = hs.keycodes.map["right"], hs.keycodes.map["end"]
local sendFnDown, sendKeyHeld = false, nil

sendTap = hs.eventtap.new({ hs.eventtap.event.types.flagsChanged, hs.eventtap.event.types.keyDown, hs.eventtap.event.types.keyUp }, function(e)
  local kind, key, flags = e:getType(), e:getKeyCode(), e:getFlags()
  if kind == hs.eventtap.event.types.flagsChanged then
    if key == FN_KEY then sendFnDown = flags.fn == true end
    return false
  end
  if kind == hs.eventtap.event.types.keyUp then
    if key == sendKeyHeld then sendKeyHeld = nil return true end
    return false
  end
  if not sendFnDown or (key ~= RIGHT and key ~= END_KEY)
      or flags.cmd or flags.ctrl or flags.alt or flags.shift then return false end
  if sendKeyHeld or e:getProperty(hs.eventtap.event.properties.keyboardEventAutorepeat) ~= 0 then return true end
  sendKeyHeld = key
  hs.timer.doAfter(0, function() toggle("f15") end)
  return true
end)
sendTap:start()

-- Left Control on its own, pressed and let go within TAP_SECONDS: sends F14
-- to Jan, which starts dictation, or stops it and sends the text. Control
-- isn't swallowed, so Control + a key or a click still works everywhere.
local LEFT_CTRL = hs.keycodes.map["ctrl"]
local ESCAPE = hs.keycodes.map["escape"]
local TAP_SECONDS = 0.35
local DICTATION_MAX_SECONDS = 600 -- Jan stops a recording after 9.5 minutes
local ctrlDownAt = nil
local dictatingSince = nil -- when a Control tap started dictation
local types = hs.eventtap.event.types

local function dictating()
  return dictatingSince ~= nil
    and hs.timer.secondsSinceEpoch() - dictatingSince < DICTATION_MAX_SECONDS
end

-- Escape while dictating: Shift + F13 tells Jan to throw the recording away.
-- Returns true when it did, so the Escape goes no further.
local function cancelDictationOnEscape(e)
  if e:getKeyCode() ~= ESCAPE or not dictating() then return false end
  local flags = e:getFlags()
  if flags.cmd or flags.alt or flags.ctrl or flags.shift then return false end
  dictatingSince = nil
  hs.timer.doAfter(0, function() toggle("f13", { "shift" }) end)
  return true
end

dictateTap = hs.eventtap.new({ types.flagsChanged, types.keyDown, types.leftMouseDown, types.rightMouseDown, types.scrollWheel }, function(e)
  if e:getType() ~= types.flagsChanged then
    ctrlDownAt = nil -- used with another key or the mouse: not a tap
    return e:getType() == types.keyDown and cancelDictationOnEscape(e)
  end
  local flags = e:getFlags()
  if e:getKeyCode() == LEFT_CTRL and flags:containExactly({ "ctrl" }) then
    ctrlDownAt = hs.timer.secondsSinceEpoch()
  elseif e:getKeyCode() == LEFT_CTRL and not flags.ctrl and ctrlDownAt then
    if hs.timer.secondsSinceEpoch() - ctrlDownAt < TAP_SECONDS then
      dictatingSince = (not dictating()) and hs.timer.secondsSinceEpoch() or nil
      hs.timer.doAfter(0, function() toggle("f14") end)
    end
    ctrlDownAt = nil
  else
    ctrlDownAt = nil -- another modifier joined in
  end
  return false
end)
dictateTap:start()

-- Background typing: post to the pinned app, never activate, focus or click
-- a window. Safari must have Hi-chat selected in its last active window.
local heldTypingKeys = {}
local optionDownAt = nil
local LEFT_OPTION = hs.keycodes.map.alt
local TYPING_MARK = 0x4A545950
local typingProps = hs.eventtap.event.properties
local typingKeys = hs.keycodes.map
local editCommands = { [typingKeys.a] = true, [typingKeys.c] = true,
  [typingKeys.v] = true, [typingKeys.x] = true, [typingKeys.z] = true }
local passKeys = { [typingKeys.pageup] = true, [typingKeys.pagedown] = true,
  [typingKeys.home] = true, [typingKeys["end"]] = true }
for i = 1, 20 do
  local key = typingKeys["f" .. i]
  if key then passKeys[key] = true end
end

local function typingWindow()
  if hs.eventtap.isSecureInputEnabled and hs.eventtap.isSecureInputEnabled() then return nil end
  for _, name in ipairs(APPS) do
    local app = hs.application.get(name)
    local win = app and (app:focusedWindow() or app:mainWindow())
    local title = win and (win:title() or ""):lower() or ""
    if win and win:isStandard() and win:isVisible() and not title:find("sign in", 1, true)
      and (name == "Jan" or title:find("hi-chat", 1, true)) then
      return { app = app, win = win, id = win:id() }
    end
  end
end

-- The window showing Hi-chat, wherever it is: the Jan web app, or the
-- Safari window whose current tab is Hi-chat (other Safari windows are not)
local function hiChatWindow()
  if typingTarget and typingTarget.win then return typingTarget.win end
  for _, name in ipairs(APPS) do
    local app = hs.application.get(name)
    for _, win in ipairs(app and app:allWindows() or {}) do
      local title = (win:title() or ""):lower()
      if win:isStandard() and (name == "Jan" or title:find("hi-chat", 1, true)) then
        return win
      end
    end
  end
end

local function typingValid(target)
  if hs.eventtap.isSecureInputEnabled and hs.eventtap.isSecureInputEnabled() then return false end
  local ok, valid = pcall(function()
    local win = target.app:focusedWindow() or target.app:mainWindow()
    local title = win and (win:title() or ""):lower() or ""
    return win and win:id() == target.id and win:isVisible()
      and not title:find("sign in", 1, true)
      and (target.app:name() == "Jan" or title:find("hi-chat", 1, true))
  end)
  return ok and valid
end

local function typingSignal(target, key, mods)
  for _, down in ipairs({ true, false }) do
    local event = hs.eventtap.event.newKeyEvent(mods or {}, key, down)
    event:setProperty(typingProps.eventSourceUserData, TYPING_MARK)
    event:post(target.app)
  end
end

local function stopTyping(message)
  local target = typingTarget
  typingTarget = nil
  if target then pcall(typingSignal, target, "f19") end
  if typingPointerOff then pcall(typingPointerOff) end
  if message and message ~= "Jan typing OFF" then print("[jan typing]", message) end
end

local function toggleTyping()
  if typingTarget then stopTyping("Jan typing OFF") return end
  local target = typingWindow()
  if not target then
    print("[jan typing] Select Hi-chat in Safari once, return to your main app, then tap Option")
    return
  end
  local ok = pcall(function()
    typingSignal(target, "f17") -- focus only the page's draft field; no auto-send
    typingSignal(target, "f18") -- explicit on signal for the keyboard symbol
  end)
  if not ok then print("[jan typing] Could not enable Jan typing") return end
  typingTarget = target
  if typingPointerOn then
    local ok, err = pcall(typingPointerOn, target)
    if not ok then print("[jan typing] could not move the pointer:", err) end
  end
end

-- Global so macOS cannot garbage-collect the tap. Copied events are tagged
-- before posting, so neither this tap nor the Z/X navigation sees them again.
typingTap = hs.eventtap.new({ types.flagsChanged, types.keyDown, types.keyUp,
  types.leftMouseDown, types.rightMouseDown, types.scrollWheel }, function(e)
  if e:getProperty(typingProps.eventSourceUserData) == TYPING_MARK then return false end
  local kind, key, flags = e:getType(), e:getKeyCode(), e:getFlags()
  if kind == types.flagsChanged then
    if key == LEFT_OPTION and flags:containExactly({ "alt" }) then
      optionDownAt = hs.timer.secondsSinceEpoch()
    elseif key == LEFT_OPTION and not flags.alt and optionDownAt then
      local tapped = hs.timer.secondsSinceEpoch() - optionDownAt < TAP_SECONDS
      optionDownAt = nil
      if tapped then hs.timer.doAfter(0, toggleTyping) end
    else optionDownAt = nil end
    return false
  end
  optionDownAt = nil -- a chord, click or scroll is not an Option tap
  if kind ~= types.keyDown and kind ~= types.keyUp then return false end
  local held = heldTypingKeys[key]
  if kind == types.keyUp then
    if not held then return false end
    heldTypingKeys[key] = nil
    local copy = e:copy()
    copy:setProperty(typingProps.eventSourceUserData, TYPING_MARK)
    pcall(function() copy:post(held.app) end)
    return true
  end
  if not typingTarget then return held ~= nil end -- swallow repeats until release
  if key == typingKeys.escape then
    if cancelDictationOnEscape(e) then return true end -- typing stays on
    stopTyping("Jan typing OFF")
    return true
  end
  if not typingValid(typingTarget) then
    stopTyping("Jan typing stopped — select Hi-chat again")
    return true -- do not leak this character into the main app
  end
  if flags.fn or passKeys[key] or (sendFnDown and (key == RIGHT or key == END_KEY)) then return false end -- keep fn helpers
  if key == typingKeys.tab or flags.ctrl or (flags.cmd and not editCommands[key]) then
    stopTyping("Jan typing OFF")
    return false -- system/app commands still reach the main window
  end
  local chars = e:getCharacters()
  local editing = key == typingKeys.delete or key == typingKeys.forwarddelete
    or key == typingKeys.left or key == typingKeys.right
    or key == typingKeys.up or key == typingKeys.down
  if not editing and (not chars or chars == "") then return false end
  if (key == RETURN or key == PAD_ENTER) and not flags.shift then
    -- Return sends the question like fn+Right; Shift+Return stays a newline.
    local target = typingTarget
    if pcall(typingSignal, target, "f15") then heldTypingKeys[key] = target
    else stopTyping("Jan typing stopped — could not deliver text") end
    return true
  end
  local copy = e:copy()
  copy:setProperty(typingProps.eventSourceUserData, TYPING_MARK)
  local target = typingTarget
  local ok = pcall(function() copy:post(target.app) end)
  if ok then heldTypingKeys[key] = target
  else stopTyping("Jan typing stopped — could not deliver text") end
  return true
end)
typingTap:start()

-- fn + trackpad: while fn is held, scroll gestures are moved to the Jan
-- window. The glide after you lift your fingers follows the same gesture,
-- even if fn is already released.
local MARK = 0x4A414E -- tags our own copies so they aren't caught again
local props = hs.eventtap.event.properties
local redirecting = false
local cached, cachedAt = nil, 0

local function chatCenter()
  if hs.timer.secondsSinceEpoch() - cachedAt > 1 then
    local win = chatWindow()
    cached = nil
    if win then
      local f = win:frame()
      cached = { x = f.x + f.w / 2, y = f.y + f.h / 2 }
    end
    cachedAt = hs.timer.secondsSinceEpoch()
  end
  return cached
end

-- Global on purpose: a local tap would be garbage-collected and stop working
scrollTap = hs.eventtap.new({ hs.eventtap.event.types.scrollWheel }, function(e)
  if e:getProperty(props.eventSourceUserData) == MARK then return false end
  local momentum = e:getProperty(props.scrollWheelEventMomentumPhase)
  if e:getFlags().fn or typingTarget then -- Option typing scrolls Jan too
    redirecting = true
  elseif momentum == 0 then
    redirecting = false
  end
  if not redirecting then return false end
  local at = chatCenter()
  if not at then return false end
  -- A fresh event, not a copy of the trackpad's: a copy can carry the
  -- pointer to the monitor with it. Same distance, phase and glide.
  local dy = e:getProperty(props.scrollWheelEventPointDeltaAxis1)
  local dx = e:getProperty(props.scrollWheelEventPointDeltaAxis2)
  if FLIP then dy = -dy end
  local ev = hs.eventtap.event.newScrollEvent({ dx, dy }, {}, "pixel")
  ev:setProperty(props.scrollWheelEventIsContinuous, 1)
  ev:setProperty(props.scrollWheelEventScrollPhase,
    e:getProperty(props.scrollWheelEventScrollPhase))
  ev:setProperty(props.scrollWheelEventMomentumPhase, momentum)
  ev:setProperty(props.eventSourceUserData, MARK)
  ev:location(at)
  return true, { ev }
end)
scrollTap:start()

-- Z / X: jump to Jan's prompt box and back. While Hammerspoon runs, the
-- z and x keys no longer type letters (Shift + Z / X still type capitals).
local Z, X = hs.keycodes.map.z, hs.keycodes.map.x
local lastOnLaptop -- where the pointer was last seen off Jan (kept up to date below)

local function inside(point, rect)
  return point.x >= rect.x and point.x < rect.x + rect.w and point.y >= rect.y and point.y < rect.y + rect.h
end

-- Where the prompt box is: Jan has just put the cursor in it (F17), so it is
-- the focused element. Falls back to the bottom middle of the window.
local function promptBoxPoint(win)
  local f = win:frame()
  local ok, el = pcall(function()
    return hs.axuielement.systemWideElement():attributeValue("AXFocusedUIElement")
  end)
  if ok and el then
    local r = el:attributeValue("AXFrame")
    if r and r.w and r.w > 0 and inside({ x = r.x + 1, y = r.y + 1 }, f) then
      return { x = r.x + math.min(r.w / 2, 200), y = r.y + r.h / 2 }, "prompt box"
    end
  end
  return { x = f.x + f.w / 2, y = f.y + f.h - 80 }, "bottom of window (prompt box not found)"
end

-- How the pointer moves: GLIDE = 0 makes it vanish here and appear there in
-- one step, with nothing drawn in between (keep it 0: the laptop screen is shared)
local GLIDE = 0
local glideTimer
local function glide(to, done)
  if glideTimer then glideTimer:stop() glideTimer = nil end
  local from = hs.mouse.absolutePosition()
  local steps = math.max(1, math.floor(GLIDE * 60))
  local i = 0
  local function step()
    i = i + 1
    local t = i / steps
    local e = 1 - (1 - t) ^ 3 -- ease out: fast start, soft landing
    hs.mouse.absolutePosition({ x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e })
    if i >= steps then
      if glideTimer then glideTimer:stop() glideTimer = nil end
      if done then done() end
      return true
    end
  end
  if steps <= 1 then step() return end
  glideTimer = hs.timer.doEvery(1 / 60, step)
end

-- Dummy cursor: while the real pointer is over on Jan, a look-alike pointer stays
-- where it was on the laptop screen, so the shared screen still shows a cursor.
-- Set DUMMY_CURSOR = false to turn it off.
local DUMMY_CURSOR = true
local cursorScale = 1
do -- Accessibility scaling is in screen points, independent of Retina pixels.
  local out = hs.execute("defaults read com.apple.universalaccess mouseDriverCursorSize 2>/dev/null")
  cursorScale = math.max(1, tonumber(out) or 1)
end
local dummy -- the canvas, while it is showing
-- Read a native cursor's image, logical size and hotspot. Keep them as they
-- are; do not stretch a hand-drawn polygon or add an outline/shadow.
local function readCursor(expr)
  local path = os.tmpname() .. ".tiff"
  local ok, result = hs.osascript.javascript(string.format([[
    ObjC.import('AppKit');
    const cursor = %s;
    const image = cursor.image;
    const size = image.size;
    const hotspot = cursor.hotSpot;
    if (!image.TIFFRepresentation.writeToFileAtomically(%q, true))
      throw new Error('Could not export native cursor');
    JSON.stringify({w: size.width, h: size.height, x: hotspot.x, y: hotspot.y});
  ]], expr, path))
  local image, info
  if ok and type(result) == "string" then
    local decoded, data = pcall(hs.json.decode, result)
    if decoded and type(data) == "table" and tonumber(data.w) and tonumber(data.h)
      and tonumber(data.x) and tonumber(data.y) and data.w > 0 and data.h > 0 then
      image = hs.image.imageFromPath(path)
      if image then info = data end
    end
  end
  os.remove(path)
  if image then return image, info end
end
-- The arrow is read once as the fallback. Each time the dummy appears it
-- copies whatever the pointer looks like right then (the I-beam while it
-- is over text, the hand over a link), so the stand-in matches the real one.
local cursorImage, cursorInfo = readCursor("$.NSCursor.arrowCursor")
if not cursorImage then
  hs.printf("Jan remote: native cursor unavailable; dummy cursor disabled.")
end

local function hideDummy()
  if dummy then dummy:delete() dummy = nil end
end

local function showDummy(at)
  hideDummy()
  if not DUMMY_CURSOR or not cursorImage then return end
  local image, info = readCursor("$.NSCursor.currentSystemCursor")
  if not image then image, info = cursorImage, cursorInfo end
  local k = cursorScale
  dummy = hs.canvas.new({
    x = at.x - info.x * k, y = at.y - info.y * k,
    w = info.w * k, h = info.h * k,
  })
  dummy:appendElements({
    type = "image", image = image,
    imageScaling = "scaleToFit", imageAlignment = "center",
    frame = { x = 0, y = 0, w = info.w * k, h = info.h * k },
  })
  dummy:level(hs.canvas.windowLevels.cursor or hs.canvas.windowLevels.overlay)
  dummy:behavior({ "canJoinAllSpaces", "stationary" })
  dummy:show()
end

local lastBox -- where the prompt box was last time, so Z can head straight there

local function jumpToJan()
  local win = chatWindow()
  if not win then
    print("[jan jump] Z: no Jan window found (is the Jan app open?)")
    return
  end
  local here = hs.mouse.absolutePosition()
  local f = win:frame()
  if not inside(here, f) then showDummy(here) end
  local guess = (lastBox and inside(lastBox, f)) and lastBox or { x = f.x + f.w / 2, y = f.y + f.h - 80 }
  -- Start moving at once; focus and the prompt box happen while it glides
  local app = win:application()
  app:activate(true) -- bring all of Jan's windows forward
  win:raise()
  win:focus()
  -- F17 once Jan is active: Jan puts the cursor in the prompt box
  hs.timer.doAfter(0.08, function() hs.eventtap.keyStroke({}, "f17", 20000) end)
  glide(guess, function() hs.timer.doAfter(0.05, function()
    local target, found = promptBoxPoint(win)
    print("[jan jump] Z: from", here.x, here.y, "to", target.x, target.y, found, "front:",
      hs.application.frontmostApplication():name())
    if found == "prompt box" then lastBox = target end
    local front = hs.application.frontmostApplication()
    local settle = function()
      -- Only click if Jan still isn't the active app
      if front ~= win:application() then hs.eventtap.leftClick(target) end
    end
    if math.abs(target.x - guess.x) + math.abs(target.y - guess.y) > 4 then
      glide(target, settle)
    else
      settle()
    end
  end) end)
end

-- Background typing takes the pointer along: it moves onto Jan's window
-- without activating Safari, a dummy cursor keeps its place on the laptop,
-- and clicks over Jan are handed to Jan as a key so your main app stays
-- the active one (nothing greys out). Scrolling over Jan already works for
-- an inactive window, so it is left alone.
local typingPointerHome -- where the pointer was when typing turned on

typingPointerOn = function(target)
  local here = hs.mouse.absolutePosition()
  local win = chatWindow() or target.win -- the window on the monitor, as Z uses
  local f = win:frame()
  if inside(here, f) then
    print("[jan typing] pointer already over Jan, left where it is")
    return
  end
  typingPointerHome = here
  -- The stand-in copies the pointer's shape before it leaves; a failure
  -- there must not stop the pointer from moving
  local ok, err = pcall(showDummy, here)
  if not ok then print("[jan typing] dummy cursor failed:", err) end
  local to = (lastBox and inside(lastBox, f)) and lastBox or { x = f.x + f.w / 2, y = f.y + f.h - 80 }
  hs.mouse.absolutePosition(to)
  print("[jan typing] pointer moved to Jan at", to.x, to.y)
end

typingPointerOff = function()
  local home = typingPointerHome
  typingPointerHome = nil
  if not home then return end
  hideDummy()
  -- Only bring it back if it is still over Jan; moved by hand, it stays put
  local win = chatWindow()
  if win and inside(hs.mouse.absolutePosition(), win:frame()) then
    hs.mouse.absolutePosition(home)
  end
end

local mouseKinds = { types.leftMouseDown, types.leftMouseUp, types.leftMouseDragged,
  types.rightMouseDown, types.rightMouseUp, types.otherMouseDown, types.otherMouseUp }
local heldClick = false -- a press over Jan is swallowed until it is let go

-- Global so macOS cannot garbage-collect the tap. A real click would make
-- Safari the active app, so a press over Jan is swallowed and Shift + F20 is
-- sent instead, with Shift + F19 on release: Jan clicks or selects text itself.
typingMouseTap = hs.eventtap.new(mouseKinds, function(e)
  if e:getProperty(typingProps.eventSourceUserData) == TYPING_MARK then return false end
  local kind = e:getType()
  local pressing = kind == types.leftMouseDown or kind == types.rightMouseDown
    or kind == types.otherMouseDown
  local releasing = kind == types.leftMouseUp or kind == types.rightMouseUp
    or kind == types.otherMouseUp
  if heldClick then
    if kind == types.leftMouseDragged then
      -- Safari only hears moves, so the drag goes on as moves it can select with.
      local move = hs.eventtap.event.newMouseEvent(types.mouseMoved, e:location())
      move:setProperty(typingProps.eventSourceUserData, TYPING_MARK)
      pcall(function() move:post() end)
    elseif releasing then
      if heldClick == "left" and typingTarget then
        pcall(typingSignal, typingTarget, "f19", { "shift" }) -- let go
      end
      heldClick = false
    end
    return true
  end
  local target = typingTarget
  if not target or not pressing then return false end
  local ok, over = pcall(function()
    local win = chatWindow() or target.win
    return inside(e:location(), win:frame())
  end)
  if not (ok and over) then return false end -- clicks elsewhere work as usual
  heldClick = true
  if kind == types.leftMouseDown then
    heldClick = "left"
    local sent = pcall(typingSignal, target, "f20", { "shift" }) -- press
    if not sent then stopTyping("Jan typing stopped — could not deliver the click") end
  end
  return true -- right and middle clicks over Jan do nothing
end)
typingMouseTap:start()

-- Keep track of where the pointer was last seen off Jan, so X works on its
-- own, whether or not Z was used
pointerWatch = hs.timer.doEvery(0.2, function()
  if glideTimer then return end -- ignore the pointer mid-glide
  local here = hs.mouse.absolutePosition()
  local win = chatWindow()
  if not (win and inside(here, win:frame())) then
    lastOnLaptop = here
    hideDummy() -- the real pointer is back, so the stand-in goes
  end
end)

-- Second window: a live copy of Jan, which fn + Left switches
-- to a live view of the screen around the pointer and back. It is drawn by
-- Hammerspoon (needs Screen Recording), never takes focus, and stays where
-- you drag it; drag its bottom-right corner to resize, x closes it.
local MIRROR_FPS = 30
local MIRROR_EDGE = 0.2 -- the pointer view pans only once the pointer is this close to its edge
local MIRROR_KEY = "janMirrorFrame"
local mirror, mirrorTimer, mirrorMode, mirrorDrag = nil, nil, "jan", nil
local mirrorWarned = false
local mirrorArea = nil -- the part of the screen the pointer view shows
local captureMs, captureCount, captureSince = 0, 0, 0

local function mirrorFrame()
  local saved = hs.settings and hs.settings.get(MIRROR_KEY)
  if saved and saved.w then return saved end
  local f = hs.screen.mainScreen():frame()
  return { x = f.x + f.w - 660, y = f.y + 40, w = 640, h = 420 }
end

local function closeMirror()
  if mirrorTimer then mirrorTimer:stop() mirrorTimer = nil end
  if mirrorDrag then mirrorDrag.timer:stop() end
  if mirror then mirror:delete() mirror = nil end
  mirrorDrag = nil
end

local function snapshotOf(mode)
  local box = mirror:frame()
  if mode == "jan" then
    local win = hiChatWindow()
    return win and win:snapshot(), nil
  end
  local p = hs.mouse.absolutePosition()
  if inside(p, box) then return nil end -- over the mirror itself: keep the last frame
  local screen = hs.mouse.getCurrentScreen() or hs.screen.mainScreen()
  local full = screen:fullFrame()
  local w, h = math.min(box.w, full.w), math.min(box.h, full.h)
  local a = mirrorArea
  if not a or a.w ~= w or a.h ~= h or not inside(a, full) then
    a = { x = p.x - w / 2, y = p.y - h / 2, w = w, h = h } -- centre on the pointer
  else
    -- Hold still while the pointer moves inside; pan only near the edge, so
    -- the picture doesn't shake with every small movement
    local mx, my = w * MIRROR_EDGE, h * MIRROR_EDGE
    a = { x = math.max(p.x - w + mx, math.min(a.x, p.x - mx)),
          y = math.max(p.y - h + my, math.min(a.y, p.y - my)), w = w, h = h }
  end
  a.x = math.max(full.x, math.min(a.x, full.x + full.w - w))
  a.y = math.max(full.y, math.min(a.y, full.y + full.h - h))
  mirrorArea = a
  return screen:snapshot(screen:absoluteToLocal(a)), { x = p.x - a.x, y = p.y - a.y }
end

local function followDrag()
  local p, d = hs.mouse.absolutePosition(), mirrorDrag
  local f = d.frame
  if d.resize then
    mirror:frame({ x = f.x, y = f.y, w = math.max(240, f.w + p.x - d.from.x),
      h = math.max(160, f.h + p.y - d.from.y) })
  else
    mirror:frame({ x = f.x + p.x - d.from.x, y = f.y + p.y - d.from.y, w = f.w, h = f.h })
  end
  if not hs.eventtap.checkMouseButtons().left then
    d.timer:stop()
    mirrorDrag = nil
    if hs.settings then hs.settings.set(MIRROR_KEY, mirror:frame()) end
  end
end

local function drawMirror()
  if not mirror or mirrorDrag then return end
  local started = hs.timer.absoluteTime and hs.timer.absoluteTime()
  local ok, image, dot = pcall(snapshotOf, mirrorMode)
  if started then
    captureMs = captureMs + (hs.timer.absoluteTime() - started) / 1e6
    captureCount = captureCount + 1
    local now = hs.timer.secondsSinceEpoch()
    if now - captureSince >= 5 then
      print(string.format("[jan mirror] %s view: %d frames, capture %.1f ms each",
        mirrorMode, captureCount, captureMs / captureCount))
      captureMs, captureCount, captureSince = 0, 0, now
    end
  end
  if ok and image then
    mirror[2].image = image
    local box = mirror:frame()
    if dot then
      mirror[3].center = { x = dot.x, y = dot.y }
      mirror[3].action = "fill"
    else
      mirror[3].action = "skip"
    end
    mirror[2].frame = { x = 0, y = 0, w = box.w, h = box.h }
  elseif not mirrorWarned and (not ok or (mirrorMode == "jan" and hiChatWindow())) then
    mirrorWarned = true
    print("[jan mirror] no picture: allow Hammerspoon in System Settings > Privacy & Security > Screen Recording", image)
    hs.alert.show("Allow Hammerspoon in Screen Recording to show the mirror")
  end
end

local function openMirror()
  local f = mirrorFrame()
  mirror = hs.canvas.new(f)
  mirror:appendElements(
    { type = "rectangle", action = "fill", fillColor = { white = 0.09 },
      roundedRectRadii = { xRadius = 10, yRadius = 10 } },
    { type = "image", imageScaling = "scaleProportionally", imageAlignment = "center",
      frame = { x = 0, y = 0, w = f.w, h = f.h } },
    { type = "circle", action = "skip", fillColor = { red = 1, green = 0.3, blue = 0.2, alpha = 0.9 },
      center = { x = 0, y = 0 }, radius = 5 }, -- a circle ignores frame: it needs centre and radius
    { id = "close", type = "text", text = "×", textSize = 16, textAlignment = "center",
      textColor = { white = 1, alpha = 0.5 }, trackMouseDown = true,
      frame = { x = "100%", y = 4, w = 22, h = 22 } },
    { id = "grip", type = "rectangle", action = "fill", fillColor = { white = 1, alpha = 0.15 },
      trackMouseDown = true, frame = { x = 0, y = 0, w = 16, h = 16 } })
  local placed
  local function place()
    local box = mirror:frame()
    if placed and placed.w == box.w and placed.h == box.h then return end
    placed = { w = box.w, h = box.h }
    mirror[4].frame = { x = box.w - 26, y = 4, w = 22, h = 22 }
    mirror[5].frame = { x = box.w - 16, y = box.h - 16, w = 16, h = 16 }
  end
  place()
  mirror:canvasMouseEvents(true, false, false, false)
  mirror:mouseCallback(function(_, message, id)
    if message ~= "mouseDown" then return end
    if id == "close" then hs.timer.doAfter(0, closeMirror) return end
    mirrorDrag = { from = hs.mouse.absolutePosition(), frame = mirror:frame(), resize = id == "grip" }
    mirrorDrag.timer = hs.timer.doEvery(1 / 60, followDrag)
  end)
  mirror:clickActivating(false) -- clicking it never takes focus from your app
  mirror:level(hs.canvas.windowLevels.floating)
  mirror:behavior({ "canJoinAllSpaces", "stationary" })
  mirror:show()
  mirrorTimer = hs.timer.doEvery(1 / MIRROR_FPS, function()
    drawMirror()
    if mirror then place() end
  end)
  drawMirror()
end

-- The live mirror: JanMirror, a small helper built from JanMirror.swift into
-- ~/.hammerspoon/JanMirror, streams with ScreenCaptureKit at 60 fps. Without
-- it, the screenshot mirror above is used instead.
local MIRROR_HELPER = os.getenv("HOME") .. "/.hammerspoon/JanMirror"
local MIRROR_NOTE = "dev.hitechie.janmirror"
local helperTask = nil

local function helperBuilt()
  return hs.fs and hs.fs.attributes(MIRROR_HELPER, "mode") == "file"
end

local function tellHelper(info)
  local function post() hs.distributednotifications.post(MIRROR_NOTE, nil, info) end
  if helperTask and helperTask:isRunning() then return post() end
  helperTask = hs.task.new(MIRROR_HELPER, function(code)
    print("[jan mirror] helper exited", code)
  end, function(_, out, err)
    if out and out ~= "" then print(out) end
    if err and err ~= "" then print(err) end
    return true
  end)
  helperTask:start()
  hs.timer.doAfter(0.5, post) -- give it a moment to start listening
end

-- fn + Left opens the mirror, then switches it between Jan and the
-- screen around the pointer.
local function switchMirror()
  if helperBuilt() then
    local win = hiChatWindow()
    if not win then print("[jan mirror] no Safari window shows Hi-chat; open it in a window's front tab") end
    tellHelper({ command = "toggle", window = win and tostring(win:id()) or "0" })
    return
  end
  if not mirror then
    mirrorMode = "jan"
    openMirror()
  else
    mirrorMode = mirrorMode == "jan" and "pointer" or "jan"
    mirrorArea = nil
    drawMirror()
  end
  print("[jan mirror] showing", mirrorMode)
end

-- fn + Left: on a Mac keyboard fn + Left is Home. It reaches Hammerspoon
-- even while Option typing is on; Home no longer reaches the app in front.
mirrorKey = hs.hotkey.bind({}, "home", function() switchMirror() end)
-- fn + Shift + Left closes the mirror altogether
mirrorCloseKey = hs.hotkey.bind({ "shift" }, "home", function()
  if helperBuilt() then
    if helperTask and helperTask:isRunning() then tellHelper({ command = "hide" }) end
  elseif mirror then
    closeMirror()
  end
end)

local function jumpBack()
  local here = hs.mouse.absolutePosition()
  local back = lastOnLaptop
  if not back then
    local laptop = hs.screen.primaryScreen()
    for _, sc in ipairs(hs.screen.allScreens()) do
      if sc:name():find("Built%-in") then laptop = sc end
    end
    local f = laptop:frame()
    back = { x = f.x + f.w / 2, y = f.y + f.h / 2 }
  end
  print("[jan jump] X: at", here.x, here.y, "back to", back.x, back.y)
  glide(back)
  hideDummy()
  -- Give focus to the window under that spot
  for _, w in ipairs(hs.window.orderedWindows()) do
    if inside(back, w:frame()) then w:focus() break end
  end
end

-- Global for the same reason as scrollTap
jumpTap = hs.eventtap.new({ hs.eventtap.event.types.keyDown }, function(e)
  if typingTarget or heldTypingKeys[e:getKeyCode()]
    or e:getProperty(props.eventSourceUserData) == TYPING_MARK then return false end
  local flags = e:getFlags()
  if flags.fn or flags.cmd or flags.ctrl or flags.alt or flags.shift then return false end
  -- Holding the key down repeats it; only the first press counts
  if e:getProperty(hs.eventtap.event.properties.keyboardEventAutorepeat) ~= 0 then
    local k = e:getKeyCode()
    return k == Z or k == X
  end
  local key = e:getKeyCode()
  -- Window and focus changes run just after this key is swallowed; done
  -- inside it, macOS can ignore them
  if key == Z then
    hs.timer.doAfter(0, jumpToJan)
    return true
  elseif key == X then
    hs.timer.doAfter(0, jumpBack)
    return true
  end
  return false
end)
jumpTap:start()

-- macOS switches a listener off if it ever answers too slowly; switch it
-- back on so fn + scroll keeps working
tapWatchdog = hs.timer.doEvery(2, function()
  for _, tap in ipairs({ scrollTap, jumpTap, sendTap, dictateTap, typingTap, typingMouseTap }) do
    if not tap:isEnabled() then
      print("[jan] a listener was switched off by macOS, restarting it")
      tap:start()
    end
  end
  if typingTarget then
    if not typingValid(typingTarget) then stopTyping("Jan typing stopped — select Hi-chat again")
    elseif not pcall(typingSignal, typingTarget, "f18") then stopTyping("Jan typing stopped") end
  end
end)

-- Auto-update: when this script is loaded from a clone of the repo (as
-- install.sh sets up), pull main when Hammerspoon starts and every 10
-- minutes. A change rebuilds the mirror helper if JanMirror.swift changed,
-- then reloads Hammerspoon, so nothing has to be copied by hand.
local UPDATE_EVERY = 60 -- seconds; each check is one small ls-remote, pulling only on a change
local scriptDir = (debug.getinfo(1, "S").source or ""):match("^@(.+)/[^/]+$")
local repoDir = scriptDir and scriptDir:gsub("/scripts/hammerspoon$", "")
local function quoted(path) return "'" .. path:gsub("'", "'\\''") .. "'" end

local function shell(command, done)
  local task = hs.task.new("/bin/sh", function(code, out, err)
    done(code, out or "", err or "")
  end, { "-c", command })
  task:start()
  return task
end

local function buildHelper(done)
  local source = repoDir .. "/scripts/hammerspoon/JanMirror.swift"
  print("[jan update] building the mirror helper")
  shell("/usr/bin/swiftc -O -parse-as-library " .. quoted(source) .. " -o " .. quoted(MIRROR_HELPER)
    .. " && (/usr/bin/pkill -x JanMirror; true)", function(code, _, err)
    if code ~= 0 then print("[jan update] helper build failed: " .. err) end
    if done then done() end
  end)
end

-- An update reloads silently: no "ready" pop-up
local function quietReload()
  hs.settings.set("janQuietReload", true)
  hs.reload()
end

local function checkForUpdate()
  local repo = quoted(repoDir)
  shell("cd " .. repo .. " && remote=$(git ls-remote origin refs/heads/main | cut -f1) && git rev-parse HEAD"
    .. ' && { [ "$remote" = "$(git rev-parse HEAD)" ] || git pull -q --ff-only origin main; } && git rev-parse HEAD',
    function(code, out, err)
      if code ~= 0 then print("[jan update] could not pull: " .. err) return end
      local before, after = out:match("^(%x+)%s+(%x+)")
      if not before or before == after then return end
      print("[jan update] updated " .. before:sub(1, 7) .. " -> " .. after:sub(1, 7))
      shell("cd " .. repo .. " && git diff --name-only " .. before .. " " .. after, function(_, files)
        if files:find("JanMirror.swift", 1, true) then
          buildHelper(quietReload)
        elseif files:find("scripts/hammerspoon/", 1, true) then
          quietReload()
        end
      end)
    end)
end

if repoDir and hs.fs and hs.fs.attributes(repoDir .. "/.git", "mode") == "directory" then
  if not helperBuilt() then buildHelper() end
  updateTimer = hs.timer.doEvery(UPDATE_EVERY, checkForUpdate)
  hs.timer.doAfter(5, checkForUpdate)
  print("[jan update] watching " .. repoDir .. " for updates")
end

if hs.settings.get("janQuietReload") then
  hs.settings.set("janQuietReload", nil)
else
  hs.alert.show("Jan remote ready (Option moves the pointer)")
end
