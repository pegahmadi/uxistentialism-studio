import Link from "next/link";

const link = "cursor-pointer border-b border-line2 text-ink hover:border-muted";

export default function TodayPage() {
  return (
    <div className="mx-auto max-w-[620px] px-9 pb-[72px] pt-[84px]">
      <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">
        THIS MORNING · ◆ ORIENTS
      </div>
      <h1 className="mt-4 font-serif text-[30px] font-bold leading-[1.3] tracking-[-0.015em]">
        The field moved toward you.
      </h1>
      <div
        className="mt-6 flex flex-col gap-[22px] text-[17px] leading-[1.85] text-strong"
        style={{ textWrap: "pretty" }}
      >
        <p style={{ animation: "rise .7s ease .05s backwards" }}>
          <b className="font-medium text-ink">Authority Architecture</b> can stand. The series has held
          through three rounds and needs only a final read before it travels.{" "}
          <Link href="/iteration" className={`${link} font-medium`}>Open the manuscript ↵</Link>
        </p>
        <p style={{ animation: "rise .7s ease .18s backwards" }}>
          Overnight the world kept arguing your case. <span className="text-amber">Cursor and AI code
          generation are accelerating</span> — production keeps getting cheaper while no one names what
          judgment is for. And a thread on design-system automation is echoing your claim that systems
          are becoming decision systems.{" "}
          <Link href="/field" className={`${link} font-medium`}>The signals are gathering in the Field</Link>, none urgent.
        </p>
        <p style={{ animation: "rise .7s ease .3s backwards" }}>
          If I may plan your day: read Authority Architecture through in the morning and let it go. Then
          spend the afternoon in the Field, not the manuscript — <i>decision memory</i> is collecting
          evidence faster than you are reading it.
        </p>
        <p className="text-[15px] text-muted" style={{ animation: "rise .7s ease .42s backwards" }}>
          Still forming, nothing to do yet: <i>Decision Memory</i> crossed the threshold overnight —{" "}
          <Link href="/formation" className="border-b border-line2 hover:border-muted">Formation</Link> will
          make its case when you are ready. The question underneath it — <i>what should the system
          remember, and why?</i> — is the one worth holding.
        </p>
        <p className="text-[15px] text-faint" style={{ animation: "rise .7s ease .54s backwards" }}>— ◆</p>
      </div>
    </div>
  );
}
