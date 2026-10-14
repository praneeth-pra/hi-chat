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
--                           Enter adds a line; fn + Right sends the prompt.
--
-- On a Mac keyboard fn + Up / Down are Page Up / Page Down, so while
-- Hammerspoon runs, those keys no longer reach other apps. Left / Right
-- arrows and fn + Left remain available to the app in front.
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

local function typingSignal(target, key)
  for _, down in ipairs({ true, false }) do
    local event = hs.eventtap.event.newKeyEvent({}, key, down)
    event:setProperty(typingProps.eventSourceUserData, TYPING_MARK)
    event:post(target.app)
  end
end

local function stopTyping(message)
  local target = typingTarget
  typingTarget = nil
  if target then pcall(typingSignal, target, "f19") end
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
  local copy = e:copy()
  if key == RETURN or key == PAD_ENTER then
    flags.shift = true
    copy:setFlags(flags) -- a normal Enter is a newline, not a send
  end
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
  if e:getFlags().fn then
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

-- Dummy cursor: while the real pointer is over on Jan, a look-alike arrow stays
-- where it was on the laptop screen, so the shared screen still shows a cursor.
-- Set DUMMY_CURSOR = false to turn it off.
local DUMMY_CURSOR = true
local cursorScale = 1
do -- Accessibility scaling is in screen points, independent of Retina pixels.
  local out = hs.execute("defaults read com.apple.universalaccess mouseDriverCursorSize 2>/dev/null")
  cursorScale = math.max(1, tonumber(out) or 1)
end
local dummy -- the canvas, while it is showing
local cursorImage, cursorInfo
-- Read the native arrow once. Keep its logical size and hotspot; do not stretch
-- a hand-drawn polygon or add a second outline/shadow to the system artwork.
do
  local path = os.tmpname() .. ".tiff"
  local ok, result = hs.osascript.javascript(string.format([[
    ObjC.import('AppKit');
    const cursor = $.NSCursor.arrowCursor;
    const image = cursor.image;
    const size = image.size;
    const hotspot = cursor.hotSpot;
    if (!image.TIFFRepresentation.writeToFileAtomically(%q, true))
      throw new Error('Could not export native cursor');
    JSON.stringify({w: size.width, h: size.height, x: hotspot.x, y: hotspot.y});
  ]], path))
  if ok and type(result) == "string" then
    local decoded, info = pcall(hs.json.decode, result)
    if decoded and type(info) == "table" and tonumber(info.w) and tonumber(info.h)
      and tonumber(info.x) and tonumber(info.y) and info.w > 0 and info.h > 0 then
      cursorImage = hs.image.imageFromPath(path)
      if cursorImage then cursorInfo = info end
    end
  end
  os.remove(path)
  if not cursorImage then
    hs.printf("Jan remote: native cursor unavailable; dummy cursor disabled.")
  end
end

local function hideDummy()
  if dummy then dummy:delete() dummy = nil end
end

local function showDummy(at)
  hideDummy()
  if not DUMMY_CURSOR or not cursorImage then return end
  local k = cursorScale
  dummy = hs.canvas.new({
    x = at.x - cursorInfo.x * k, y = at.y - cursorInfo.y * k,
    w = cursorInfo.w * k, h = cursorInfo.h * k,
  })
  dummy:appendElements({
    type = "image", image = cursorImage,
    imageScaling = "scaleToFit", imageAlignment = "center",
    frame = { x = 0, y = 0, w = cursorInfo.w * k, h = cursorInfo.h * k },
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
  for _, tap in ipairs({ scrollTap, jumpTap, sendTap, dictateTap, typingTap }) do
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

hs.alert.show("Jan scroller ready")
