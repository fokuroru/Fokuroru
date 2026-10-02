package dev.fokuroru.reader.data

data class QueuedProgress(
    val id: Long,
    val chapterId: Int,
    val page: Int,
    val completed: Boolean,
    val seconds: Int,
    val final: Boolean,
    val at: Long,
)

/** One write per chapter: the latest position, summed reading time, and a completion that sticks. */
data class MergedProgress(
    val chapterId: Int,
    val page: Int,
    val completed: Boolean,
    val seconds: Int,
    val final: Boolean,
    val ids: List<Long>,
)

object ProgressMerge {
    /** The server clamps a single report to 15 minutes, so a longer stretch counts as 15. */
    const val MAX_SECONDS = 15 * 60

    fun merge(rows: List<QueuedProgress>): List<MergedProgress> =
        rows.sortedBy { it.at }
            .groupBy { it.chapterId }
            .map { (chapterId, entries) ->
                MergedProgress(
                    chapterId = chapterId,
                    page = entries.last().page,
                    completed = entries.any { it.completed },
                    seconds = entries.sumOf { it.seconds }.coerceIn(0, MAX_SECONDS),
                    final = entries.any { it.final },
                    ids = entries.map { it.id },
                )
            }
}
