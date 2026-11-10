import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ChatHome } from '../../../features/chat/chat-home.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('chat'))('title') };
}

export default function ChatPage() {
  return <ChatHome />;
}
