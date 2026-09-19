# In-app documentation

The public docs hub is `/app/docs`, with guides for the One Only idea, launching, trading, fees and graduation, and wallet/community features. The app navigation and footer link to the hub. Telegram support opens `https://t.me/OneOnlylol_bot` without sending a message automatically.

Guide content is maintained in `apps/web/src/lib/docs-content.ts`. Pages are server rendered, use the existing app theme, and do not require wallet authentication. Each guide has section links and next-guide navigation.

The initial content uses the existing project brief (`bible.md`) for the motivation and the current implementation for behavior. Earlier brief details such as mandatory creator first buys and permanent ticker ownership were not carried over because the implementation has changed.

The additional Claude artifact supplied by the owner could not be retrieved through the research tool or a direct HTTP request. Its text was requested and remains pending; do not describe the docs as incorporating that artifact until it has been reviewed.

Validation: TypeScript validation; production build; HTTP checks for the hub, five guides, section anchors, and support links. No wallet transactions or Telegram messages are part of these checks.
