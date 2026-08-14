import LandingPage from './LandingPage';

// The site is a single page. The old hash router also served a post-purchase
// setup guide, which the license server's claim page replaced.
export default function App() {
  return <LandingPage />;
}
