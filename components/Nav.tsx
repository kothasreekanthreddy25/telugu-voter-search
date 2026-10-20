'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Search', icon: '🎤' },
  { href: '/import/', label: 'Import', icon: '📥' },
  { href: '/database/', label: 'Database', icon: '🗄️' },
  { href: '/settings/', label: 'Settings', icon: '⚙️' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t bg-white">
      <ul className="mx-auto flex max-w-xl">
        {ITEMS.map((i) => {
          const active = i.href === '/' ? path === '/' : path.startsWith(i.href.slice(0, -1));
          return (
            <li key={i.href} className="flex-1">
              <Link href={i.href} className={`flex flex-col items-center py-2 text-xs ${active ? 'font-semibold text-indigo-600' : 'text-slate-500'}`}>
                <span className="text-xl">{i.icon}</span>{i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
