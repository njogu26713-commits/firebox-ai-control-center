CREATE TABLE `personas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`assistantName` varchar(80) NOT NULL DEFAULT 'Firebox AI',
	`tone` varchar(80) NOT NULL DEFAULT 'Warm, concise, and capable',
	`role` varchar(160) NOT NULL DEFAULT 'WhatsApp automation guide',
	`behaviorInstructions` text NOT NULL,
	`welcomeMessage` text NOT NULL,
	`guardrails` text NOT NULL,
	`enabledActions` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personas_id` PRIMARY KEY(`id`),
	CONSTRAINT `personas_ownerId_unique` UNIQUE(`ownerId`)
);
--> statement-breakpoint
CREATE TABLE `whatsappSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`status` enum('not_configured','waiting_qr','waiting_pairing','connected','expired','error') NOT NULL DEFAULT 'not_configured',
	`phoneNumber` varchar(32),
	`pairingCode` varchar(32),
	`qrPayload` text,
	`expiresAt` timestamp,
	`lastConnectedAt` timestamp,
	`lastError` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsappSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsappSessions_ownerId_unique` UNIQUE(`ownerId`)
);
