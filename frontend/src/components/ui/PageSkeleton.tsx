import { Skeleton } from '@mantine/core'

/**
 * Stand-in for a route that is still loading: a title, a toolbar and a grid of cover slots, so the
 * page does not jump from an empty spinner to a full layout. Decorative, hence hidden from
 * assistive tech; the route announces itself once it renders.
 */
export function PageSkeleton() {
  return (
    <div aria-hidden="true" style={{ paddingBlock: 8 }}>
      <Skeleton h={34} w={220} mb={10} />
      <Skeleton h={12} w={360} maw="100%" mb={24} />
      <Skeleton h={36} maw={520} mb={20} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 16,
        }}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} style={{ aspectRatio: '2 / 3' }} />
        ))}
      </div>
    </div>
  )
}
