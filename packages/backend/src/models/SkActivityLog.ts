/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { SkActivityContext } from '@/models/SkActivityContext.js';
import { MiUser } from '@/models/_.js';
import { id } from './util/id.js';

@Entity('activity_log')
export class SkActivityLog {
	@PrimaryColumn({
		...id(),
		primaryKeyConstraintName: 'PK_activity_log',
	})
	public id: string;

	@Index('IDX_activity_log_at')
	@Column('timestamptz')
	public at: Date;

	@Column({
		type: 'text',
		name: 'key_id',
	})
	public keyId: string;

	@Index('IDX_activity_log_host')
	@Column('text')
	public host: string;

	@Column('boolean')
	public verified: boolean;

	@Column('boolean')
	public accepted: boolean;

	@Column('text')
	public result: string;

	@Column('jsonb')
	// https://github.com/typeorm/typeorm/issues/8559
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public activity: any;

	@Column({
		type: 'text',
		name: 'context_hash',
		nullable: true,
	})
	public contextHash: string | null;

	@ManyToOne(() => SkActivityContext, {
		onDelete: 'CASCADE',
		nullable: true,
	})
	@JoinColumn({
		name: 'context_hash',
		foreignKeyConstraintName: 'FK_activity_log_context_hash',
	})
	public context: SkActivityContext | null;

	@Column({
		...id(),
		name: 'auth_user_id',
		nullable: true,
	})
	public authUserId: string | null;

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
		nullable: true,
	})
	@JoinColumn({
		name: 'auth_user_id',
		foreignKeyConstraintName: 'FK_activity_log_auth_user_id',
	})
	public authUser: MiUser | null;

	constructor(data?: Partial<SkActivityLog>) {
		if (data) {
			Object.assign(this, data);
		}
	}
}
