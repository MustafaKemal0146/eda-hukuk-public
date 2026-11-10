import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ConversationScreen } from '../../../../features/chat/conversation-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('chat'))('title') };
}

export default async function ConversationPage({ params }: PageProps<'/sohbet/[conversationId]'>) {
  const { conversationId } = await params;
  return <ConversationScreen conversationId={conversationId} />;
}
