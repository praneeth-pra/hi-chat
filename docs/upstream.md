# Upstream Jan and Hi-chat's own code

Hi-chat is a web-only fork of [Jan](https://github.com/janhq/jan)
(`https://github.com/janhq/jan`). `core/`, `extensions-web/` and most of
`web-app/` came from there; `relay/`, `mac-app/`, `windows-app/`, `nginx.conf`,
the `Dockerfile` and the Railway setup are Hi-chat's own.

## Finding the fork point

This repository's history starts with an `Initial commit` dated
**2026-10-03** (`git log --reverse | head`): the Jan sources were imported as
a snapshot, so the histories may share no commit. To compare with upstream:

```sh
git remote add upstream https://github.com/janhq/jan.git
git fetch upstream
# Works only if the import kept Jan's history:
git merge-base HEAD upstream/main
# Otherwise take the last upstream commit before the import and diff
# against it:
git rev-list -1 --before=2026-10-03 upstream/main
git diff <that-commit> HEAD -- web-app/src core
```

When pulling an upstream change, apply it to the upstream-shaped files and
leave `web-app/src/features/hichat/` alone; Hi-chat code there only touches
upstream files through the imports listed below.

## Hi-chat feature folders

Under `web-app/src/features/hichat/`:

- `mirror/` - the remote mirror: the `/m/$link` and `/mirror` viewer
  (`MirrorView.tsx`, `view/`), the sending side and its transport
  (`lib/remoteMirror.ts`, `mirrorDirect.ts`, `mirrorGate.ts`, `mirrorLink.ts`,
  `remoteInput.ts`), and the thread buttons (`MirrorLinkButton.tsx`,
  `RemoteSessionButton.tsx`, `useRemoteSession.ts`, `MirrorCodeToast.tsx`).
  Upstream files that import it: `routes/__root.tsx`, `routes/m/$link.tsx`,
  `hooks/useChat.ts`, `containers/ThreadContent.tsx`,
  `containers/ThreadActions.tsx`.
- `camera/` - the remote camera (`remoteCamera.ts`, `useCameraSender.ts`,
  `RemoteCameraPanel.tsx`), used by the mirror page. The Meet extension stays
  in `web-app/public/hichat-extension/`.

Route files stay in `web-app/src/routes/` (TanStack's file-based routing
needs them there) and import from the feature folders.

## Follow-up: features not moved yet

These are also Hi-chat additions but are woven through upstream files
(`ChatInput.tsx`, `useChat.ts`, `routes/settings/general.tsx`,
`ThreadActions.tsx`, `ContextMeter.tsx`, `DropdownModelProvider.tsx`,
`chatModels.ts`) and through each other, so moving them is a larger change
left for later:

- dictation: `lib/dictation.ts`, `lib/dictation/`, `dictationDelivery.ts`,
  `dictationFixes.ts` (+ `dictation-fixes.txt`), `dictationJudge.ts`,
  `englishOnly.ts`, `micActivity.ts`, `computerAudio.ts`,
  `hooks/useDictationEnabled.ts`, `containers/DictationToggleButton.tsx`,
  `containers/DictationIndicator.tsx`
- speech services: `lib/speechServices.ts`, `speechAudio.ts`,
  `speechLive.ts`, `keyTerms.ts`
- auto answers (Speed/Accuracy): `lib/answerWarm.ts`, `autoRace.ts`,
  `accuracyReview.ts`, `answerDetail.ts`, `replySpeed.ts`, `replyTiming.ts`
- remote keys and screenshots: `lib/remoteKeys.ts`, `screenshotDelivery.ts`,
  `containers/RemoteKeysProvider.tsx` (these depend on dictation)

Move dictation and speech together (they import each other), then auto
answers, updating `vi.mock` paths in the tests along with the imports.
