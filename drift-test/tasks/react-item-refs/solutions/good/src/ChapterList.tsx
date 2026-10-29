import { useEffect, useRef } from 'react'

type Chapter = { id: string; title: string }

export function ChapterList({ chapters, selectedId }: { chapters: Chapter[]; selectedId?: string }) {
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map())

  useEffect(() => {
    if (selectedId) itemRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  return (
    <ul>
      {chapters.map((chapter) => (
        <li
          key={chapter.id}
          data-id={chapter.id}
          ref={(el) => {
            if (el) itemRefs.current.set(chapter.id, el)
            return () => {
              itemRefs.current.delete(chapter.id)
            }
          }}
        >
          {chapter.title}
        </li>
      ))}
    </ul>
  )
}
