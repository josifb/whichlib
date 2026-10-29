import { useEffect, useRef } from 'react'

type Chapter = { id: string; title: string }

export function ChapterList({ chapters, selectedId }: { chapters: Chapter[]; selectedId?: string }) {
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({})

  useEffect(() => {
    if (selectedId) itemRefs.current[selectedId]?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  return (
    <ul>
      {chapters.map((chapter) => (
        <li key={chapter.id} data-id={chapter.id} ref={(el) => (itemRefs.current[chapter.id] = el)}>
          {chapter.title}
        </li>
      ))}
    </ul>
  )
}
