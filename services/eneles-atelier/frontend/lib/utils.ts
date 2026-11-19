import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { Metadata } from "next";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

/** A byte count in the reader's locale, e.g. "1.5 MB". */
export function formatFileSize(bytes: number): string {
	const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const
	let i = 0
	let value = bytes
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024
		i++
	}
	return new Intl.NumberFormat(undefined, {
		style: "unit",
		unit: units[i],
		unitDisplay: i === 0 ? "long" : "short",
		maximumFractionDigits: i === 0 ? 0 : 1,
	}).format(value)
}

/** "1 file", "3 files": a count with the noun in the right number for the reader's locale. */
export function formatCount(n: number, one: string, other: string): string {
	const word = new Intl.PluralRules(undefined).select(n) === "one" ? one : other
	return `${new Intl.NumberFormat().format(n)} ${word}`
}

export function generateMeta({
	title,
	description,
	canonical
}: {
	title: string;
	description: string;
	canonical: string;
}): Metadata {
	return {
		title: `${title}`,
		description: description,
		metadataBase: process.env.BASE_URL ? new URL(process.env.BASE_URL) : undefined,
		alternates: {
			canonical: `/dashboard${canonical}`
		},
		openGraph: {
			images: [`${process.env.DASHBOARD_BASE_URL}/seo.jpg`]
		}
	};
}
