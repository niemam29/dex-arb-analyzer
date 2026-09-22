-- UWAGA: ALTER TYPE ... ADD VALUE nie może być użyte w tej samej transakcji — kolejne migracje w tym samym uruchomieniu NIE mogą używać nowych wartości enum ('baseline_v2', 'calibrate:baseline_v2').
ALTER TYPE "public"."model_kind" ADD VALUE 'baseline_v2';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'calibrate:baseline_v2';