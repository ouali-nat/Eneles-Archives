-- Who may open the operators' panel. Off for everyone; turned on per account by the root administrator or by hand.
ALTER TABLE "users" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;
