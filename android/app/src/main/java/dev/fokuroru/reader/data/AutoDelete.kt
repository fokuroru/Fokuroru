package dev.fokuroru.reader.data

data class DownloadedChapter(
    val chapterId: Int,
    val seriesId: Int,
    val completed: Boolean,
    val readAt: Long,
    val pendingSync: Boolean,
)

/** Which saved chapters to drop once read. Mirrors the server's keep-last-read rule. */
object AutoDelete {
    fun plan(chapters: List<DownloadedChapter>, keepLast: Boolean): List<Int> {
        val held = if (keepLast) {
            chapters.filter { it.completed }
                .groupBy { it.seriesId }
                .mapNotNull { (_, rows) -> rows.maxByOrNull { it.readAt }?.chapterId }
                .toSet()
        } else {
            emptySet()
        }
        return chapters
            .filter { it.completed && !it.pendingSync && it.chapterId !in held }
            .map { it.chapterId }
    }
}
