# Native AI/history preview check, 2026-10-31

Verified candidate HAP SHA256: `2da2cd9b41b19a677a4f019623cbb1343425ac11d36e60e1f7287d17d24a5dc4`.
Build directory: `C:/Users/ASUS/AppData/Local/Temp/pengan-oh7-7818207418b4`.
Native source fingerprint: `3b6a230de4bda116211b4fb8f5b4174df86a311d2c7605d2f63106cd6797b42d`.

`native-home-720x1280.jpg` is the verified genuine ArkUI home page (real-data mode, no simulated 4ppm/680 cards). `native-720x1280.jpg` is the last frame after a real navigation-input attempt, still the home page; it must not be described as an assistant/history screenshot.

Official input source `MouseInputImpl.cpp` assigns coordinates directly to pointer x/y without a density conversion. The inspector/render picture places the assistant tab at physical pixel (290,50). The capture tool now optionally keeps the same WebSocket open for 7 seconds after first frame, sends official `MousePress` / `MouseRelease` commands to the existing native command pipe, and consumes subsequent complete messages. Logs confirm commands and native TouchPress/TouchRelease dispatch. Before/after raw frame hashes differ; the later image shows the assistant button hover colour, but the selected page remains home. Thus this is not merely a reused first frame, and navigation completion is not established.

An initial sustained-read attempt raised a .NET WebSocket reserved-bits exception; a bounded repeat succeeded in receiving later frames. This is intermittent SDK transport behaviour, not proof of application failure. No parameters were guessed further and no State/source injection was used. Assistant, patrol, and real history native page layouts still need verified input or board acceptance.

Reproduce home:
```powershell
./tools/preview-native7.ps1 -CompilePreview -OutputDirectory tmp/verification/ai-history-preview
```
Bounded diagnostic input (does not guarantee navigation): add `-ClickX 290 -ClickY 50`. Output path is restricted to workspace `tmp/verification`. Default home capture was retested successfully. No board connection, no public listener, no business-source or formal manifest modification. Native preview does not validate real system bars or real AI/provider execution.
