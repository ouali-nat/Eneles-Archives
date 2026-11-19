"use client"

import { useId, useState, type FormEvent } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Container } from "@/components/ui/container"
import { SaveStatus, type SaveState } from "@/components/ui/status"
import { PageHeader } from "@/components/essential/layout/PageHeader"
import { Avatar } from "@/components/people/Avatar"
import { AvatarChooser, avatarChange, initialAvatarDraft, personWithDraft, type AvatarDraft } from "@/components/people/AvatarPicker"
import { DeleteAccount } from "@/components/essential/dashboard/DeleteAccount"
import { useAuth } from "@/lib/auth-context"
import { API_URL, apiFetch, usersAPI } from "@/lib/api"
import { cn } from "@/lib/utils"
import { RelativeTime } from "@/components/ui/time"

type Details = { name: string; affiliation: string; location: string; bio: string }
const LIMITS = { name: 100, affiliation: 120, location: 120, bio: 160 }

const joined = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" })
const card = "rounded-[var(--radius-surface)] border border-line bg-card p-5"

/** A labelled field with an optional line under it; the line is the error when there is one. */
function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="type-base font-medium">
        {label}
      </label>
      {children}
      {(error || hint) && (
        <p id={`${id}-hint`} className={cn("type-small", error ? "text-danger" : "text-muted-foreground")}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth()
  const id = useId()
  const fromUser = (): Details => ({ name: user?.name ?? "", affiliation: user?.affiliation ?? "", location: user?.location ?? "", bio: user?.bio ?? "" })
  const [saved, setSaved] = useState<Details>(fromUser)
  const [draft, setDraft] = useState<Details>(fromUser)
  const [avatar, setAvatar] = useState<AvatarDraft>(() => initialAvatarDraft(user ?? {}))
  const [state, setState] = useState<SaveState>("idle")
  const [nameError, setNameError] = useState("")
  const [saveError, setSaveError] = useState("")

  // The account may load after the page (a reload straight onto Profile); take its details once they arrive.
  const [seenUser, setSeenUser] = useState(user?.id)
  if (user?.id !== seenUser) {
    setSeenUser(user?.id)
    const next = fromUser()
    setSaved(next)
    setDraft(next)
    setAvatar(initialAvatarDraft(user ?? {}))
  }

  const person = user ?? {}
  const pictureChange = avatarChange(person, avatar)
  const dirty = !!pictureChange || (Object.keys(draft) as (keyof Details)[]).some((key) => draft[key].trim() !== saved[key].trim())
  // Editing after a save (or a failed one) shows Unsaved changes; undoing every edit clears it.
  const shownState: SaveState = state === "saving" ? "saving" : dirty ? (state === "error" ? "error" : "unsaved") : state === "error" ? "idle" : state

  const set = (key: keyof Details) => (event: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [key]: event.target.value }))
    if (key === "name") setNameError("")
  }

  const discard = () => {
    if (avatar.preview) URL.revokeObjectURL(avatar.preview)
    setDraft(saved)
    setAvatar(initialAvatarDraft(person))
    setNameError("")
    setSaveError("")
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.name.trim()) {
      setNameError("Enter the name people will see.")
      return
    }
    setState("saving")
    setSaveError("")
    try {
      // A new photo is uploaded first, so a failed upload leaves the details unsaved too and nothing half done.
      if (pictureChange && "upload" in pictureChange) {
        const body = new FormData()
        body.append("avatar", pictureChange.upload)
        const response = await apiFetch(`${API_URL}/users/profile/avatar`, { method: "POST", body })
        if (!response.ok) {
          const data = await response.json().catch(() => null)
          throw new Error(data?.message || "The photo could not be uploaded.")
        }
      }
      const next = { name: draft.name.trim(), affiliation: draft.affiliation.trim(), location: draft.location.trim(), bio: draft.bio.trim() }
      await usersAPI.updateProfile({ ...next, ...(pictureChange && "preset" in pictureChange ? { avatarUrl: pictureChange.preset } : {}) })
      if (avatar.preview) URL.revokeObjectURL(avatar.preview)
      setSaved(next)
      setDraft(next)
      setState("saved")
      // The saved profile comes back with the picture as stored (a photo as a signed link), which the next draft starts from.
      await refreshUser()
      setAvatar((current) => ({ ...current, file: null, preview: null, keepSaved: true, use: current.use }))
    } catch (e) {
      setSaveError(e instanceof Error && e.message ? e.message : "")
      setState("error")
    }
  }

  return (
    <Container>
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Profile"
          description={
            user?.createdAt ? (
              <>
                How collaborators see you. Member since <RelativeTime value={user.createdAt}>{joined.format(new Date(user.createdAt))}</RelativeTime>.
              </>
            ) : (
              "How collaborators see you."
            )
          }
        />

        <form onSubmit={save} className={cn(card, "flex flex-col gap-5")} noValidate aria-label="Profile">
          {/* The face sits beside the name it belongs to; Change opens the picture's choices. */}
          <div className="flex flex-col gap-5 @min-[40rem]:flex-row @min-[40rem]:items-start @min-[40rem]:gap-2">
            {/* The picture has a column of its own, wide enough that it and its button are not crowded by the fields. */}
            <div className="flex shrink-0 items-center gap-4 @min-[40rem]:w-44 @min-[40rem]:flex-col @min-[40rem]:items-center @min-[40rem]:gap-4 @min-[40rem]:py-2">
              <Avatar person={personWithDraft(person, avatar)} size="xl" />
              {user && <AvatarChooser person={user} draft={avatar} onChange={setAvatar} />}
            </div>
            <div className="grid min-w-0 flex-1 gap-5 @min-[48rem]:grid-cols-2">
              <Field id={`${id}-name`} label="Name" error={nameError}>
                <Input id={`${id}-name`} value={draft.name} onChange={set("name")} maxLength={LIMITS.name} autoComplete="name" aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `${id}-name-hint` : undefined} />
              </Field>
              <Field
                id={`${id}-email`}
                label="Email"
                hint={
                  <>
                    Sign-in codes are sent here. To move your account to another address,{" "}
                    <Link href="/contact" className="text-foreground underline underline-offset-4 hover:no-underline">
                      write to us
                    </Link>
                    .
                  </>
                }
              >
                <Input id={`${id}-email`} value={user?.email ?? ""} readOnly aria-readonly className="text-muted-foreground" aria-describedby={`${id}-email-hint`} />
              </Field>
              <Field id={`${id}-affiliation`} label="Affiliation">
                <Input id={`${id}-affiliation`} value={draft.affiliation} onChange={set("affiliation")} maxLength={LIMITS.affiliation} placeholder="University, lab, or company" autoComplete="organization" />
              </Field>
              <Field id={`${id}-location`} label="Location">
                <Input id={`${id}-location`} value={draft.location} onChange={set("location")} maxLength={LIMITS.location} placeholder="City, country" />
              </Field>
              <Field id={`${id}-bio`} label="Bio" hint={`${draft.bio.length} of ${LIMITS.bio} characters`} className="@min-[48rem]:col-span-2">
                <Textarea id={`${id}-bio`} value={draft.bio} onChange={set("bio")} maxLength={LIMITS.bio} rows={3} className="min-h-24 resize-none" placeholder="What you work on" aria-describedby={`${id}-bio-hint`} />
              </Field>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5">
            <SaveStatus state={shownState} className="me-auto" />
            {state === "error" && saveError && <span className="type-small text-danger">{saveError}</span>}
            <Button type="button" variant="outline" disabled={!dirty || state === "saving"} onClick={discard}>
              Discard
            </Button>
            <Button type="submit" disabled={!dirty || state === "saving"}>
              Save changes
            </Button>
          </div>
        </form>

        <DeleteAccount />
      </div>
    </Container>
  )
}
