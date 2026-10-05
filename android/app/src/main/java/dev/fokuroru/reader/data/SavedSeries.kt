package dev.fokuroru.reader.data

/** One series' saved chapters, as the saved-chapters grid shows it. */
data class SavedSeries(
    val seriesId: Int,
    /** Empty until a queued chapter's manifest has been read, which is when its series becomes known. */
    val title: String,
    /** Chapters on the device and readable: the number on the badge. */
    val saved: Int,
    val pending: Int,
    val failed: Int,
    val bytes: Long,
)

object SavedSeriesGroups {
    /** One entry per series, by title, with series not yet known (queued, nothing read yet) last. */
    fun group(rows: List<Download>): List<SavedSeries> =
        rows.groupBy { it.seriesId }
            .map { (seriesId, chapters) ->
                SavedSeries(
                    seriesId = seriesId,
                    title = chapters.firstOrNull { it.seriesTitle.isNotEmpty() }?.seriesTitle.orEmpty(),
                    saved = chapters.count { it.state == State.DONE },
                    pending = chapters.count { it.state == State.QUEUED || it.state == State.DOWNLOADING },
                    failed = chapters.count { it.state == State.FAILED },
                    bytes = chapters.filter { it.state == State.DONE }.sumOf { it.bytes },
                )
            }
            .sortedWith(
                compareBy<SavedSeries> { it.title.isEmpty() }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.title }
                    .thenBy { it.seriesId },
            )
}
