-- Trigram search support (trusted extension; no superuser needed on PG13+).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('INVITED', 'ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE', 'DO_NOT_SERVICE');

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('PHONE', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('FURNACE', 'AIR_CONDITIONER', 'HEAT_PUMP', 'AIR_HANDLER', 'MINI_SPLIT', 'ROOFTOP_UNIT', 'BOILER', 'THERMOSTAT', 'HUMIDIFIER', 'DEHUMIDIFIER', 'VENTILATION', 'COMMERCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "EquipmentCondition" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'NEEDS_REPLACEMENT', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'APPOINTMENT_SCHEDULED', 'ESTIMATE_NEEDED', 'QUOTE_SENT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NEW', 'UNSCHEDULED', 'SCHEDULED', 'DISPATCHED', 'EN_ROUTE', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'NEEDS_FOLLOW_UP', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'DISPATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "LineItemKind" AS ENUM ('SERVICE', 'LABOR', 'MATERIAL', 'EQUIPMENT', 'DISCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('NONE', 'PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'READY', 'SENT', 'VIEWED', 'APPROVED', 'DECLINED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'SENT', 'VIEWED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CHECK', 'CREDIT_CARD', 'ACH', 'EXTERNAL', 'MANUAL', 'FINANCING', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "NoteType" AS ENUM ('GENERAL', 'TECHNICIAN', 'BILLING', 'CUSTOMER_SERVICE', 'SALES', 'INTERNAL', 'WARNING', 'ACCESS');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('CUSTOMER', 'LOCATION', 'EQUIPMENT', 'LEAD', 'JOB', 'APPOINTMENT', 'QUOTE', 'INVOICE', 'PAYMENT', 'AGREEMENT', 'EMPLOYEE', 'EXPENSE', 'TASK', 'TENANT');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PHOTO', 'DOCUMENT', 'MANUAL', 'WARRANTY', 'CONTRACT', 'RECEIPT', 'BEFORE_PHOTO', 'AFTER_PHOTO', 'PROFILE_PHOTO', 'LOGO', 'SIGNATURE', 'OTHER');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'CUSTOMER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PublicLinkKind" AS ENUM ('QUOTE', 'INVOICE', 'PORTAL');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('PENDING_RENEWAL', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('PLANNED', 'SCHEDULED', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('QUOTE_APPROVED', 'QUOTE_DECLINED', 'QUOTE_VIEWED', 'INVOICE_PAID', 'INVOICE_OVERDUE', 'PAYMENT_RECEIVED', 'JOB_ASSIGNED', 'SCHEDULE_CHANGED', 'CUSTOMER_MESSAGE', 'AGREEMENT_RENEWAL', 'TASK_ASSIGNED', 'MENTION', 'LOW_STOCK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('EQUIPMENT', 'PARTS', 'FUEL', 'VEHICLE', 'TOOLS', 'ADVERTISING', 'OFFICE', 'SOFTWARE', 'SUBCONTRACTORS', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryLocationType" AS ENUM ('WAREHOUSE', 'TRUCK');

-- CreateEnum
CREATE TYPE "InventoryTxnType" AS ENUM ('RECEIVE', 'ADJUST', 'CONSUME', 'TRANSFER_IN', 'TRANSFER_OUT', 'RETURN');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'BOUNCED', 'FAILED');

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthlyCents" INTEGER NOT NULL DEFAULT 0,
    "maxUsers" INTEGER NOT NULL DEFAULT 5,
    "maxTechnicians" INTEGER NOT NULL DEFAULT 3,
    "maxCustomers" INTEGER NOT NULL DEFAULT 1000,
    "maxStorageMb" INTEGER NOT NULL DEFAULT 5120,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ONBOARDING',
    "onboardingCompletedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEndsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "maxUsersOverride" INTEGER,
    "maxTechniciansOverride" INTEGER,
    "maxCustomersOverride" INTEGER,
    "maxStorageMbOverride" INTEGER,
    "billingProvider" TEXT,
    "billingCustomerId" TEXT,
    "billingSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerifiedAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "activeTenantId" TEXT,
    "impersonatingTenantId" TEXT,
    "impersonationReason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "taxId" TEXT,
    "registrationNumber" TEXT,
    "licenseNumber" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "defaultTaxRateBp" INTEGER NOT NULL DEFAULT 0,
    "logoKey" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#1d4ed8',
    "quoteIntro" TEXT,
    "quoteFooter" TEXT,
    "invoiceFooter" TEXT,
    "emailSignature" TEXT,
    "businessHours" JSONB NOT NULL DEFAULT '{}',
    "serviceAreaNotes" TEXT,
    "defaultAppointmentMinutes" INTEGER NOT NULL DEFAULT 90,
    "jobPrefix" TEXT NOT NULL DEFAULT 'JOB-',
    "jobStartNumber" INTEGER NOT NULL DEFAULT 1001,
    "quotePrefix" TEXT NOT NULL DEFAULT 'Q-',
    "quoteStartNumber" INTEGER NOT NULL DEFAULT 1001,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV-',
    "invoiceStartNumber" INTEGER NOT NULL DEFAULT 1001,
    "agreementPrefix" TEXT NOT NULL DEFAULT 'MA-',
    "agreementStartNumber" INTEGER NOT NULL DEFAULT 1001,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "acceptedPaymentMethods" "PaymentMethod"[] DEFAULT ARRAY['CASH', 'CHECK', 'CREDIT_CARD', 'ACH']::"PaymentMethod"[],
    "defaultDepositBp" INTEGER NOT NULL DEFAULT 0,
    "quoteExpirationDays" INTEGER NOT NULL DEFAULT 30,
    "quoteTerms" TEXT,
    "invoiceTerms" TEXT,
    "requireQuoteSignature" BOOLEAN NOT NULL DEFAULT false,
    "onboardingProgress" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "roleId" TEXT NOT NULL,
    "employeeId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_territories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "postalCodes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "hireDate" DATE,
    "terminationDate" DATE,
    "photoKey" TEXT,
    "internalNotes" TEXT,
    "isTechnician" BOOLEAN NOT NULL DEFAULT false,
    "skills" TEXT[],
    "calendarColor" TEXT NOT NULL DEFAULT '#2563eb',
    "territoryId" TEXT,
    "hourlyCostCents" INTEGER,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelationship" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_certifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "issuer" TEXT,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_availability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_off" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'RESIDENTIAL',
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "phoneAlt" TEXT,
    "email" TEXT,
    "preferredContact" "ContactMethod" NOT NULL DEFAULT 'PHONE',
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "billingLine1" TEXT,
    "billingLine2" TEXT,
    "billingCity" TEXT,
    "billingState" TEXT,
    "billingPostalCode" TEXT,
    "billingCountry" TEXT NOT NULL DEFAULT 'US',
    "referralSource" TEXT,
    "tags" TEXT[],
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "taxExemptReason" TEXT,
    "accountNotes" TEXT,
    "internalNotes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isBilling" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "billToCustomer" BOOLEAN NOT NULL DEFAULT true,
    "gateInstructions" TEXT,
    "parkingInstructions" TEXT,
    "accessCodes" TEXT,
    "onSiteContactName" TEXT,
    "onSiteContactPhone" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "EquipmentType" NOT NULL,
    "systemType" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "unitLocation" TEXT,
    "installDate" DATE,
    "manufactureDate" DATE,
    "warrantyExpiresAt" DATE,
    "laborWarrantyExpiresAt" DATE,
    "equipmentWarrantyExpiresAt" DATE,
    "refrigerantType" TEXT,
    "capacityTons" DECIMAL(5,2),
    "seer" DECIMAL(5,2),
    "filterSize" TEXT,
    "fuelType" TEXT,
    "condition" "EquipmentCondition" NOT NULL DEFAULT 'GOOD',
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "requestedService" TEXT,
    "source" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "lostReason" TEXT,
    "assignedToId" TEXT,
    "estimatedValueCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "customerId" TEXT,
    "locationId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricebook_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricebook_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricebook_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT,
    "kind" "LineItemKind" NOT NULL DEFAULT 'SERVICE',
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "imageKey" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricebook_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultDurationMin" INTEGER NOT NULL DEFAULT 90,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobTypeId" TEXT,
    "name" TEXT NOT NULL,
    "items" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "jobTypeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "status" "JobStatus" NOT NULL DEFAULT 'UNSCHEDULED',
    "dispatcherId" TEXT,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 90,
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "holdReason" TEXT,
    "cancelReason" TEXT,
    "followUpReason" TEXT,
    "internalNotes" TEXT,
    "customerNotes" TEXT,
    "technicianNotes" TEXT,
    "quoteId" TEXT,
    "agreementId" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_assignees" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_equipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "installed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_line_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "LineItemKind" NOT NULL DEFAULT 'MATERIAL',
    "pricebookItemId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "inventoryItemId" TEXT,
    "addedById" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_checklist_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "doneById" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "enRouteAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_assignees" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "jobId" TEXT,
    "signerName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT,
    "jobId" TEXT,
    "salespersonId" TEXT,
    "title" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE NOT NULL,
    "expiresAt" DATE,
    "taxRateBp" INTEGER NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" INTEGER NOT NULL DEFAULT 0,
    "depositType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "depositValue" INTEGER NOT NULL DEFAULT 0,
    "terms" TEXT,
    "customerNotes" TEXT,
    "internalNotes" TEXT,
    "approvedOptionId" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "customerMessage" TEXT,
    "signatureId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedInvoiceId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_options" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "kind" "LineItemKind" NOT NULL DEFAULT 'SERVICE',
    "pricebookItemId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" INTEGER NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT,
    "jobId" TEXT,
    "quoteId" TEXT,
    "agreementId" TEXT,
    "title" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "taxRateBp" INTEGER NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" INTEGER NOT NULL DEFAULT 0,
    "depositRequiredCents" INTEGER NOT NULL DEFAULT 0,
    "terms" TEXT,
    "customerNotes" TEXT,
    "internalNotes" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "kind" "LineItemKind" NOT NULL DEFAULT 'SERVICE',
    "pricebookItemId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" INTEGER NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "isDeposit" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "provider" TEXT,
    "providerPaymentId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "customerId" TEXT,
    "type" "NoteType" NOT NULL DEFAULT 'GENERAL',
    "body" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "mentionedUserIds" TEXT[],
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_revisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" "NoteType" NOT NULL,
    "editorId" TEXT NOT NULL,
    "editorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "customerId" TEXT,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'DOCUMENT',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT,
    "caption" TEXT,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "impersonatorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "PublicLinkKind" NOT NULL,
    "entityId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_agreements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE NOT NULL,
    "renewalDate" DATE NOT NULL,
    "billingFrequency" "BillingFrequency" NOT NULL DEFAULT 'ANNUAL',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "includedVisits" INTEGER NOT NULL DEFAULT 2,
    "includedServices" TEXT,
    "discountPercentBp" INTEGER NOT NULL DEFAULT 0,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_equipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,

    CONSTRAINT "agreement_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'PLANNED',
    "jobId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeUserId" TEXT,
    "customerId" TEXT,
    "jobId" TEXT,
    "quoteId" TEXT,
    "invoiceId" TEXT,
    "createdById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "entityType" "EntityType",
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "accountNumber" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "amountCents" INTEGER NOT NULL,
    "expenseDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CREDIT_CARD',
    "reference" TEXT,
    "jobId" TEXT,
    "customerId" TEXT,
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "LineItemKind" NOT NULL DEFAULT 'MATERIAL',
    "unit" TEXT NOT NULL DEFAULT 'each',
    "vendorId" TEXT,
    "pricebookItemId" TEXT,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "reorderThreshold" INTEGER NOT NULL DEFAULT 0,
    "reorderQuantity" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "InventoryLocationType" NOT NULL DEFAULT 'WAREHOUSE',
    "name" TEXT NOT NULL,
    "employeeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "InventoryTxnType" NOT NULL,
    "quantityDelta" DECIMAL(12,2) NOT NULL,
    "unitCostCents" INTEGER,
    "jobId" TEXT,
    "employeeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "entityType" "EntityType",
    "entityId" TEXT,
    "template" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_counters" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL,

    CONSTRAINT "sequence_counters_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON "subscriptions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_tokens_userId_type_idx" ON "auth_tokens"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenantId_key" ON "tenant_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_id_key" ON "roles"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_name_key" ON "roles"("tenantId", "name");

-- CreateIndex
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenantId_id_key" ON "memberships"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenantId_userId_key" ON "memberships"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_tenantId_email_idx" ON "invitations"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tenantId_id_key" ON "invitations"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_territories_tenantId_id_key" ON "service_territories"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_territories_tenantId_name_key" ON "service_territories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "employees_tenantId_status_idx" ON "employees"("tenantId", "status");

-- CreateIndex
CREATE INDEX "employees_tenantId_isTechnician_idx" ON "employees"("tenantId", "isTechnician");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenantId_id_key" ON "employees"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenantId_membershipId_key" ON "employees"("tenantId", "membershipId");

-- CreateIndex
CREATE INDEX "employee_certifications_tenantId_employeeId_idx" ON "employee_certifications"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_certifications_tenantId_id_key" ON "employee_certifications"("tenantId", "id");

-- CreateIndex
CREATE INDEX "employee_availability_tenantId_employeeId_idx" ON "employee_availability"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_availability_tenantId_id_key" ON "employee_availability"("tenantId", "id");

-- CreateIndex
CREATE INDEX "time_off_tenantId_employeeId_startsAt_idx" ON "time_off"("tenantId", "employeeId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "time_off_tenantId_id_key" ON "time_off"("tenantId", "id");

-- CreateIndex
CREATE INDEX "customers_tenantId_status_idx" ON "customers"("tenantId", "status");

-- CreateIndex
CREATE INDEX "customers_tenantId_displayName_idx" ON "customers"("tenantId", "displayName");

-- CreateIndex
CREATE INDEX "customers_tenantId_createdAt_idx" ON "customers"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "customers_tenantId_deletedAt_idx" ON "customers"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "customers_display_name_trgm" ON "customers" USING GIN ("displayName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_email_trgm" ON "customers" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_phone_trgm" ON "customers" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_id_key" ON "customers"("tenantId", "id");

-- CreateIndex
CREATE INDEX "customer_contacts_tenantId_customerId_idx" ON "customer_contacts"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contacts_tenantId_id_key" ON "customer_contacts"("tenantId", "id");

-- CreateIndex
CREATE INDEX "customer_locations_tenantId_customerId_idx" ON "customer_locations"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "customer_locations_tenantId_postalCode_idx" ON "customer_locations"("tenantId", "postalCode");

-- CreateIndex
CREATE INDEX "locations_address_trgm" ON "customer_locations" USING GIN ("addressLine1" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "customer_locations_tenantId_id_key" ON "customer_locations"("tenantId", "id");

-- CreateIndex
CREATE INDEX "equipment_tenantId_customerId_idx" ON "equipment"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "equipment_tenantId_locationId_idx" ON "equipment"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "equipment_tenantId_type_idx" ON "equipment"("tenantId", "type");

-- CreateIndex
CREATE INDEX "equipment_serial_trgm" ON "equipment" USING GIN ("serialNumber" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_tenantId_id_key" ON "equipment"("tenantId", "id");

-- CreateIndex
CREATE INDEX "leads_tenantId_status_idx" ON "leads"("tenantId", "status");

-- CreateIndex
CREATE INDEX "leads_tenantId_assignedToId_idx" ON "leads"("tenantId", "assignedToId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenantId_id_key" ON "leads"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pricebook_categories_tenantId_id_key" ON "pricebook_categories"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pricebook_categories_tenantId_name_key" ON "pricebook_categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "pricebook_items_tenantId_categoryId_idx" ON "pricebook_items"("tenantId", "categoryId");

-- CreateIndex
CREATE INDEX "pricebook_items_tenantId_isActive_idx" ON "pricebook_items"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "pricebook_name_trgm" ON "pricebook_items" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "pricebook_items_tenantId_id_key" ON "pricebook_items"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pricebook_items_tenantId_sku_key" ON "pricebook_items"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "job_types_tenantId_id_key" ON "job_types"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_types_tenantId_name_key" ON "job_types"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_tenantId_id_key" ON "checklist_templates"("tenantId", "id");

-- CreateIndex
CREATE INDEX "jobs_tenantId_status_idx" ON "jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "jobs_tenantId_customerId_idx" ON "jobs"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "jobs_tenantId_locationId_idx" ON "jobs"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "jobs_tenantId_scheduledStart_idx" ON "jobs"("tenantId", "scheduledStart");

-- CreateIndex
CREATE INDEX "jobs_tenantId_createdAt_idx" ON "jobs"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_tenantId_id_key" ON "jobs"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_tenantId_number_key" ON "jobs"("tenantId", "number");

-- CreateIndex
CREATE INDEX "job_assignees_tenantId_employeeId_idx" ON "job_assignees"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "job_assignees_tenantId_id_key" ON "job_assignees"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_assignees_tenantId_jobId_employeeId_key" ON "job_assignees"("tenantId", "jobId", "employeeId");

-- CreateIndex
CREATE INDEX "job_equipment_tenantId_equipmentId_idx" ON "job_equipment"("tenantId", "equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "job_equipment_tenantId_id_key" ON "job_equipment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_equipment_tenantId_jobId_equipmentId_key" ON "job_equipment"("tenantId", "jobId", "equipmentId");

-- CreateIndex
CREATE INDEX "job_line_items_tenantId_jobId_idx" ON "job_line_items"("tenantId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "job_line_items_tenantId_id_key" ON "job_line_items"("tenantId", "id");

-- CreateIndex
CREATE INDEX "job_checklist_items_tenantId_jobId_idx" ON "job_checklist_items"("tenantId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "job_checklist_items_tenantId_id_key" ON "job_checklist_items"("tenantId", "id");

-- CreateIndex
CREATE INDEX "appointments_tenantId_startsAt_idx" ON "appointments"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "appointments_tenantId_jobId_idx" ON "appointments"("tenantId", "jobId");

-- CreateIndex
CREATE INDEX "appointments_tenantId_status_idx" ON "appointments"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenantId_id_key" ON "appointments"("tenantId", "id");

-- CreateIndex
CREATE INDEX "appointment_assignees_tenantId_employeeId_startsAt_idx" ON "appointment_assignees"("tenantId", "employeeId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_assignees_tenantId_id_key" ON "appointment_assignees"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_assignees_tenantId_appointmentId_employeeId_key" ON "appointment_assignees"("tenantId", "appointmentId", "employeeId");

-- CreateIndex
CREATE INDEX "signatures_tenantId_entityType_entityId_idx" ON "signatures"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "signatures_tenantId_id_key" ON "signatures"("tenantId", "id");

-- CreateIndex
CREATE INDEX "quotes_tenantId_status_idx" ON "quotes"("tenantId", "status");

-- CreateIndex
CREATE INDEX "quotes_tenantId_customerId_idx" ON "quotes"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "quotes_tenantId_createdAt_idx" ON "quotes"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "quotes_tenantId_expiresAt_idx" ON "quotes"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenantId_id_key" ON "quotes"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenantId_number_key" ON "quotes"("tenantId", "number");

-- CreateIndex
CREATE INDEX "quote_options_tenantId_quoteId_idx" ON "quote_options"("tenantId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_options_tenantId_id_key" ON "quote_options"("tenantId", "id");

-- CreateIndex
CREATE INDEX "quote_line_items_tenantId_optionId_idx" ON "quote_line_items"("tenantId", "optionId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_line_items_tenantId_id_key" ON "quote_line_items"("tenantId", "id");

-- CreateIndex
CREATE INDEX "invoices_tenantId_status_idx" ON "invoices"("tenantId", "status");

-- CreateIndex
CREATE INDEX "invoices_tenantId_customerId_idx" ON "invoices"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "invoices_tenantId_dueDate_idx" ON "invoices"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "invoices_tenantId_createdAt_idx" ON "invoices"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_id_key" ON "invoices"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_number_key" ON "invoices"("tenantId", "number");

-- CreateIndex
CREATE INDEX "invoice_line_items_tenantId_invoiceId_idx" ON "invoice_line_items"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_line_items_tenantId_id_key" ON "invoice_line_items"("tenantId", "id");

-- CreateIndex
CREATE INDEX "payments_tenantId_invoiceId_idx" ON "payments"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "payments_tenantId_customerId_idx" ON "payments"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "payments_tenantId_receivedAt_idx" ON "payments"("tenantId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_id_key" ON "payments"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_providerPaymentId_key" ON "payments"("provider", "providerPaymentId");

-- CreateIndex
CREATE INDEX "notes_tenantId_entityType_entityId_idx" ON "notes"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "notes_tenantId_customerId_createdAt_idx" ON "notes"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notes_tenantId_id_key" ON "notes"("tenantId", "id");

-- CreateIndex
CREATE INDEX "note_revisions_tenantId_noteId_idx" ON "note_revisions"("tenantId", "noteId");

-- CreateIndex
CREATE UNIQUE INDEX "note_revisions_tenantId_id_key" ON "note_revisions"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_tenantId_entityType_entityId_idx" ON "attachments"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "attachments_tenantId_customerId_idx" ON "attachments"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_tenantId_id_key" ON "attachments"("tenantId", "id");

-- CreateIndex
CREATE INDEX "activities_tenantId_customerId_createdAt_idx" ON "activities"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "activities_tenantId_entityType_entityId_createdAt_idx" ON "activities"("tenantId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "activities_tenantId_createdAt_idx" ON "activities"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "activities_tenantId_id_key" ON "activities"("tenantId", "id");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_action_idx" ON "audit_logs"("tenantId", "action");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "public_links_tokenHash_key" ON "public_links"("tokenHash");

-- CreateIndex
CREATE INDEX "public_links_tenantId_kind_entityId_idx" ON "public_links"("tenantId", "kind", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "public_links_tenantId_id_key" ON "public_links"("tenantId", "id");

-- CreateIndex
CREATE INDEX "maintenance_agreements_tenantId_status_idx" ON "maintenance_agreements"("tenantId", "status");

-- CreateIndex
CREATE INDEX "maintenance_agreements_tenantId_renewalDate_idx" ON "maintenance_agreements"("tenantId", "renewalDate");

-- CreateIndex
CREATE INDEX "maintenance_agreements_tenantId_customerId_idx" ON "maintenance_agreements"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_agreements_tenantId_id_key" ON "maintenance_agreements"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_agreements_tenantId_number_key" ON "maintenance_agreements"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_equipment_tenantId_id_key" ON "agreement_equipment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_equipment_tenantId_agreementId_equipmentId_key" ON "agreement_equipment"("tenantId", "agreementId", "equipmentId");

-- CreateIndex
CREATE INDEX "maintenance_visits_tenantId_agreementId_idx" ON "maintenance_visits"("tenantId", "agreementId");

-- CreateIndex
CREATE INDEX "maintenance_visits_tenantId_dueDate_status_idx" ON "maintenance_visits"("tenantId", "dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_visits_tenantId_id_key" ON "maintenance_visits"("tenantId", "id");

-- CreateIndex
CREATE INDEX "tasks_tenantId_status_dueAt_idx" ON "tasks"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_tenantId_assigneeUserId_status_idx" ON "tasks"("tenantId", "assigneeUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_tenantId_id_key" ON "tasks"("tenantId", "id");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_readAt_createdAt_idx" ON "notifications"("tenantId", "userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenantId_id_key" ON "notifications"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_tenantId_id_key" ON "vendors"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_tenantId_name_key" ON "vendors"("tenantId", "name");

-- CreateIndex
CREATE INDEX "expenses_tenantId_expenseDate_idx" ON "expenses"("tenantId", "expenseDate");

-- CreateIndex
CREATE INDEX "expenses_tenantId_category_idx" ON "expenses"("tenantId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_tenantId_id_key" ON "expenses"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenantId_id_key" ON "inventory_items"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenantId_sku_key" ON "inventory_items"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_tenantId_id_key" ON "inventory_locations"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_tenantId_name_key" ON "inventory_locations"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stock_tenantId_id_key" ON "inventory_stock"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stock_tenantId_itemId_locationId_key" ON "inventory_stock"("tenantId", "itemId", "locationId");

-- CreateIndex
CREATE INDEX "inventory_transactions_tenantId_itemId_createdAt_idx" ON "inventory_transactions"("tenantId", "itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_tenantId_id_key" ON "inventory_transactions"("tenantId", "id");

-- CreateIndex
CREATE INDEX "email_messages_tenantId_customerId_createdAt_idx" ON "email_messages"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "email_messages_tenantId_entityType_entityId_idx" ON "email_messages"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "email_messages_provider_providerMessageId_idx" ON "email_messages"("provider", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_tenantId_id_key" ON "email_messages"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_roleId_fkey" FOREIGN KEY ("tenantId", "roleId") REFERENCES "roles"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenantId_roleId_fkey" FOREIGN KEY ("tenantId", "roleId") REFERENCES "roles"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_territories" ADD CONSTRAINT "service_territories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenantId_membershipId_fkey" FOREIGN KEY ("tenantId", "membershipId") REFERENCES "memberships"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenantId_territoryId_fkey" FOREIGN KEY ("tenantId", "territoryId") REFERENCES "service_territories"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_availability" ADD CONSTRAINT "employee_availability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_availability" ADD CONSTRAINT "employee_availability_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "customer_locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "customer_locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "customer_locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricebook_categories" ADD CONSTRAINT "pricebook_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_tenantId_categoryId_fkey" FOREIGN KEY ("tenantId", "categoryId") REFERENCES "pricebook_categories"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_types" ADD CONSTRAINT "job_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_tenantId_jobTypeId_fkey" FOREIGN KEY ("tenantId", "jobTypeId") REFERENCES "job_types"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "customer_locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenantId_jobTypeId_fkey" FOREIGN KEY ("tenantId", "jobTypeId") REFERENCES "job_types"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignees" ADD CONSTRAINT "job_assignees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignees" ADD CONSTRAINT "job_assignees_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignees" ADD CONSTRAINT "job_assignees_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_equipment" ADD CONSTRAINT "job_equipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_equipment" ADD CONSTRAINT "job_equipment_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_equipment" ADD CONSTRAINT "job_equipment_tenantId_equipmentId_fkey" FOREIGN KEY ("tenantId", "equipmentId") REFERENCES "equipment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_line_items" ADD CONSTRAINT "job_line_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_line_items" ADD CONSTRAINT "job_line_items_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_checklist_items" ADD CONSTRAINT "job_checklist_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_checklist_items" ADD CONSTRAINT "job_checklist_items_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_assignees" ADD CONSTRAINT "appointment_assignees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_assignees" ADD CONSTRAINT "appointment_assignees_tenantId_appointmentId_fkey" FOREIGN KEY ("tenantId", "appointmentId") REFERENCES "appointments"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_assignees" ADD CONSTRAINT "appointment_assignees_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "customer_locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_options" ADD CONSTRAINT "quote_options_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_options" ADD CONSTRAINT "quote_options_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "quotes"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_tenantId_optionId_fkey" FOREIGN KEY ("tenantId", "optionId") REFERENCES "quote_options"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "customer_locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "quotes"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "invoices"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "invoices"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_tenantId_noteId_fkey" FOREIGN KEY ("tenantId", "noteId") REFERENCES "notes"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_links" ADD CONSTRAINT "public_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_agreements" ADD CONSTRAINT "maintenance_agreements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_agreements" ADD CONSTRAINT "maintenance_agreements_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_agreements" ADD CONSTRAINT "maintenance_agreements_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "customer_locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_equipment" ADD CONSTRAINT "agreement_equipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_equipment" ADD CONSTRAINT "agreement_equipment_tenantId_agreementId_fkey" FOREIGN KEY ("tenantId", "agreementId") REFERENCES "maintenance_agreements"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_equipment" ADD CONSTRAINT "agreement_equipment_tenantId_equipmentId_fkey" FOREIGN KEY ("tenantId", "equipmentId") REFERENCES "equipment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_visits" ADD CONSTRAINT "maintenance_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_visits" ADD CONSTRAINT "maintenance_visits_tenantId_agreementId_fkey" FOREIGN KEY ("tenantId", "agreementId") REFERENCES "maintenance_agreements"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_visits" ADD CONSTRAINT "maintenance_visits_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenantId_quoteId_fkey" FOREIGN KEY ("tenantId", "quoteId") REFERENCES "quotes"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "invoices"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenantId_vendorId_fkey" FOREIGN KEY ("tenantId", "vendorId") REFERENCES "vendors"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenantId_vendorId_fkey" FOREIGN KEY ("tenantId", "vendorId") REFERENCES "vendors"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenantId_pricebookItemId_fkey" FOREIGN KEY ("tenantId", "pricebookItemId") REFERENCES "pricebook_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "inventory_locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "inventory_locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_counters" ADD CONSTRAINT "sequence_counters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
