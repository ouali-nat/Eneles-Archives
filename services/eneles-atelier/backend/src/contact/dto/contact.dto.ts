import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';

export const CONTACT_TOPICS = [
  'Support',
  'Billing',
  'Teams and institutions',
  'Self-hosting',
  'Feedback',
  'Press',
  'Something else',
] as const;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** A message from the contact form. `website` is a field people never see: a form that fills it in is a bot's. */
export class ContactDto {
  @Transform(trim)
  @IsString()
  @Length(1, 120, { message: 'Add your name (up to 120 characters).' })
  name: string;

  @Transform(lower)
  @IsEmail({}, { message: 'Add an email address we can reply to.' })
  @Length(3, 254)
  email: string;

  @IsIn(CONTACT_TOPICS, { message: 'Choose what the message is about.' })
  topic: (typeof CONTACT_TOPICS)[number];

  @Transform(trim)
  @IsString()
  @Length(10, 5000, {
    message: 'Write at least a sentence (10 to 5,000 characters).',
  })
  message: string;

  @IsOptional()
  @IsString()
  website?: string;
}
