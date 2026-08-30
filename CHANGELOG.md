# Changelog

## [0.2.0](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/compare/v0.1.0...v0.2.0) (2026-08-30)


### Features

* Atlas Learn overhaul, plus the News feature and catalog sync ([34e78be](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/34e78be66dd9b378cf2a0c7d737703fcde97a4bc))
* **chat:** wire Atlas's own tools into the chat page, add a voice mode ([ff4ffc6](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/ff4ffc6cd0cdb3d18e7079119e240bf9930422fa))
* **compare:** rewrite Compare into a session-based Arena; repair task-execution UI ([0ba2bb0](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/0ba2bb0528a1419ee1ffb82ab3b8f1a49ade35cc))
* Terrain design system, auth, agentic chat, and artifact pipeline ([7ea2ab6](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/7ea2ab688c56ee4253208845d9f3e32bac6b533a))


### Bug fixes

* cap router chat maxDuration to 300s for Vercel Hobby plan ([6f5e0b5](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/6f5e0b5d6e31b6db498482d7548dd8b043eb490a))
* move news/sync cron to daily schedule ([87bc95b](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/87bc95b27f1fe5029a50ee3fc8792292ceaa8058))
* **providers:** select a servable model and wire Atlas tools into chat ([88479b7](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/88479b73c941491b027f350b84010f67f299af7b))
* **providers:** stop reporting an unreachable local provider as connected ([bdfc2c7](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/bdfc2c7a500bcf01152cb1c851921689ee535ee9))


### Performance

* cut redundant work out of the chat, code, and playground hot paths ([4f6dded](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/4f6dded7b747fd6db1cd8d0fb7cce53f06744651))
* fix the per-route interaction hot spots ([3af6c2b](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/3af6c2bc4ea477b118097717df08a1529e399d03))
* index and memoize the hot pure-lib paths ([0173f71](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/0173f7133ba445dac5f0bcbc6d6236ef52b43d56))
* keep message identity stable and memoize the chat thread ([aa79145](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/aa79145fb030887ebbde0f6b59c9bd832373ff41))
* make workspace navigation instant ([197f970](https://github.com/RohitSinghMcKvian/LLM-Atlas-Ultimate/commit/197f9701911a03e8532d3c393a7efeaf1bc37e65))
