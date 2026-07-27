import { useEffect, useState } from 'react';
import LandingPage from './LandingPage';
import SetupGuide from './SetupGuide';

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route === '#setup') return <SetupGuide />;
  return <LandingPage />;
}
