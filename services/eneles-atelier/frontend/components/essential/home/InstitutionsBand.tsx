import Image from "next/image";

/**
 * Social proof band.
 *
 * IMPORTANT: this list is empty on purpose, and the section renders nothing
 * while it stays empty. We deleted a fabricated logo cloud from this codebase
 * once already. Inventing university and company names is worse than inventing
 * logos, because they are checkable, and the audience for this product is
 * exactly the audience that checks.
 *
 * To turn the section on, add real institutions below. Only list somewhere if
 * you can point at a real account, and if you have permission to use the name
 * where the agreement requires it.
 *
 *   { name: "Institution Name" }
 *     renders the name as a wordmark. Fine to launch with.
 *
 *   { name: "Institution Name", logo: "/logos/name.svg", width: 120, height: 28 }
 *     renders the logo instead. Put files in `public/logos/`. Monochrome SVGs
 *     work best, since they inherit the muted treatment below.
 */
const INSTITUTIONS: {
  name: string;
  logo?: string;
  width?: number;
  height?: number;
}[] = [];

/** Change once you can say something stronger than "used by". */
const HEADING = "Used by researchers and teams at";

export function InstitutionsBand() {
  if (INSTITUTIONS.length === 0) return null;

  return (
    <section className="py-14">
      <div className="container">
        <p className="text-center text-sm text-muted-foreground">{HEADING}</p>

        <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 @min-[40rem]:gap-x-14">
          {INSTITUTIONS.map((item) => (
            <li key={item.name}>
              {item.logo ? (
                <Image
                  src={item.logo}
                  alt={item.name}
                  width={item.width ?? 120}
                  height={item.height ?? 28}
                  className="h-7 w-auto opacity-55 grayscale transition-opacity duration-200 hover:opacity-80"
                />
              ) : (
                <span className="text-lg font-medium tracking-tight text-muted-foreground/70 transition-colors duration-200 hover:text-foreground">
                  {item.name}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
