import { Type, type Static } from "typebox";

export const MessageSubject = Type.Union([
	Type.Literal("task"),
	Type.Literal("question"),
	Type.Literal("reply"),
]);

export const BusMessagePayloadSchema = Type.Object({
	 subject: MessageSubject,
	 content: Type.String({ description: "Message body." }),
	 attachment: Type.Array(Type.String(), {
		 description: "File paths for data that should not be embedded in the message body. Use an empty array when there are no attachments.",
	 }),
	 reply_to: Type.Optional(Type.Integer({ minimum: 1, description: "ID of the bus message being quoted or replied to." })),
});

export type BusMessageSubject = Static<typeof MessageSubject>;
export type BusMessagePayload = Static<typeof BusMessagePayloadSchema>;

export type BusDeliveredMessage = {
	id: number;
	from: string;
	to: string;
	subject: BusMessageSubject;
	content: string;
	attachment: string[];
	replyTo?: number;
	createdAt: string;
};

export function validatePayload(message: BusMessagePayload): void {
	if (!["task", "question", "reply"].includes(message.subject)) {
		throw new Error("message.subject must be one of: task, question, reply");
	}
	if (!Array.isArray(message.attachment)) {
		throw new Error("message.attachment must be a file path list");
	}
	for (const file of message.attachment) {
		if (typeof file !== "string" || file.trim() === "") {
			throw new Error("message.attachment must contain non-empty file paths");
		}
	}
	if (message.reply_to !== undefined && (!Number.isInteger(message.reply_to) || message.reply_to < 1)) {
		throw new Error("message.reply_to must be a positive message ID");
	}
}
