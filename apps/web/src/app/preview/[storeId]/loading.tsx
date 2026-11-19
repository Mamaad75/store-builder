import s from "../preview.module.css";

export default function Loading() {
  return (
    <div className={s.skeleton} role="status" aria-label="در حال بارگذاری پیش‌نمایش">
      <div className={s.bar} />
      <div className={s.block} />
      <div className={s.block} />
    </div>
  );
}
