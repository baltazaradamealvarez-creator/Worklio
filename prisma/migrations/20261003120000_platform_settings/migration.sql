-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worklio_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform_settings TO worklio_app;
  END IF;
END $$;
