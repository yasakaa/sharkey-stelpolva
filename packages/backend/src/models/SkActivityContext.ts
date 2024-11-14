/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, PrimaryColumn, Entity, Index } from 'typeorm';

@Entity('activity_context')
export class SkActivityContext {
	@PrimaryColumn('text')
	@Index()
	public md5: string;

	@Column('jsonb')
	// https://github.com/typeorm/typeorm/issues/8559
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public json: any;

	constructor(data?: Partial<SkActivityContext>) {
		if (data) {
			Object.assign(this, data);
		}
	}
}
