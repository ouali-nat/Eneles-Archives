SET search_path TO atelier, public;

-- An account an administrator has disabled: it cannot sign in, and its sessions were ended when this was set.
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'suspended';
