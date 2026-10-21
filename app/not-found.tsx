import Link from 'next/link';
import { Sheet } from '@/components/ui/Sheet';
import { Logo } from '@/components/brand/Logo';
import styles from './not-found.module.css';

/** 404: the shortest path back to something useful. */
export default function NotFound() {
  return (
    <div className={styles.shell}>
      <Logo />
      <Sheet className={styles.card}>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>That page is not here</h1>
        <p className={styles.body}>
          The link may be old, or a plan may have been deleted from this browser. Your other plans
          are unaffected.
        </p>
        <div className={styles.actions}>
          <Link className={styles.link} href="/">
            Back to my plans
          </Link>
        </div>
      </Sheet>
    </div>
  );
}
