import { chatStore } from '~/lib/stores/chat';
import { animate } from 'framer-motion';
import { cubicEasingFn } from '~/utils/easings';

// Export the function that starts the chat so we can call it from the BaseChat component
export const runChatAnimation = async () => {
  // Move the animation logic here
  if (chatStore.get().started) {
    return;
  }

  await Promise.all([
    animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
    animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
  ]);

  chatStore.setKey('started', true);
};

// We only need to export the animation function since the BaseChat component will use it
