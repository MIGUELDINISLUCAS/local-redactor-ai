import { useEffect, useState } from 'react';
import Header from './components/chat/Header';
import MessageList from './components/chat/MessageList';
import Composer from './components/chat/Composer';
import ReviewModal from './components/chat/ReviewModal';
import LocalPasteBack from './components/chat/LocalPasteBack';
import RulesModal from './components/chat/RulesModal';
import SettingsModal from './components/chat/SettingsModal';
import { useChatStore } from './store/chatStore';
import { nerStatus } from './utils/api';
import LandingPage from './LandingPage';
import SetupGuide from './SetupGuide';

function Workspace() {
  const setNerAvailable = useChatStore((s) => s.setNerAvailable);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    nerStatus()
      .then((s) => setNerAvailable(s.available))
      .catch(() => setNerAvailable(false));
  }, [setNerAvailable]);

  return (
    <div className="flex flex-col h-screen bg-slate-50 max-w-3xl mx-auto border-x border-slate-200">
      <Header onOpenRules={() => setShowRules(true)} onOpenSettings={() => setShowSettings(true)} />
      <MessageList />
      <Composer />
      <ReviewModal />
      <LocalPasteBack />
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route === '#workspace') return <Workspace />;
  if (route === '#setup') return <SetupGuide />;
  return <LandingPage />;
}
