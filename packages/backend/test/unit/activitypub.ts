/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IdService } from '@/core/IdService.js';

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';

import { ApImageService } from '@/core/activitypub/models/ApImageService.js';
import { ApNoteService } from '@/core/activitypub/models/ApNoteService.js';
import { ApPersonService } from '@/core/activitypub/models/ApPersonService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { JsonLdService } from '@/core/activitypub/JsonLdService.js';
import { CONTEXT } from '@/core/activitypub/misc/contexts.js';
import { GlobalModule } from '@/GlobalModule.js';
import { CoreModule } from '@/core/CoreModule.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { LoggerService } from '@/core/LoggerService.js';
import type { IActor, IApDocument, ICollection, IObject, IPost } from '@/core/activitypub/type.js';
import { MiMeta, MiNote, MiUser, UserProfilesRepository, UserPublickeysRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { DownloadService } from '@/core/DownloadService.js';
import type { MiRemoteUser } from '@/models/User.js';
import { genAidx } from '@/misc/id/aidx.js';
import { MockResolver } from '../misc/mock-resolver.js';

const host = 'https://host1.test';

type NonTransientIActor = IActor & { id: string };
type NonTransientIPost = IPost & { id: string };

function createRandomActor({ actorHost = host } = {}): NonTransientIActor {
	const preferredUsername = secureRndstr(8);
	const actorId = `${actorHost}/users/${preferredUsername.toLowerCase()}`;

	return {
		'@context': 'https://www.w3.org/ns/activitystreams',
		id: actorId,
		type: 'Person',
		preferredUsername,
		inbox: `${actorId}/inbox`,
		outbox: `${actorId}/outbox`,
	};
}

function createRandomNote(actor: NonTransientIActor): NonTransientIPost {
	const id = secureRndstr(8);
	const noteId = `${new URL(actor.id).origin}/notes/${id}`;

	return {
		id: noteId,
		type: 'Note',
		attributedTo: actor.id,
		content: 'test test foo',
	};
}

function createRandomNotes(actor: NonTransientIActor, length: number): NonTransientIPost[] {
	return new Array(length).fill(null).map(() => createRandomNote(actor));
}

function createRandomFeaturedCollection(actor: NonTransientIActor, length: number): ICollection {
	const items = createRandomNotes(actor, length);

	return {
		'@context': 'https://www.w3.org/ns/activitystreams',
		type: 'Collection',
		id: actor.outbox as string,
		totalItems: items.length,
		items,
	};
}

async function createRandomRemoteUser(
	resolver: MockResolver,
	personService: ApPersonService,
): Promise<MiRemoteUser> {
	const actor = createRandomActor();
	resolver.register(actor.id, actor);

	return await personService.createPerson(actor.id, resolver);
}

describe('ActivityPub', () => {
	let userProfilesRepository: UserProfilesRepository;
	let imageService: ApImageService;
	let noteService: ApNoteService;
	let personService: ApPersonService;
	let rendererService: ApRendererService;
	let jsonLdService: JsonLdService;
	let resolver: MockResolver;
	let idService: IdService;
	let userPublickeysRepository: UserPublickeysRepository;

	const metaInitial = {
		cacheRemoteFiles: true,
		cacheRemoteSensitiveFiles: true,
		enableFanoutTimeline: true,
		enableFanoutTimelineDbFallback: true,
		perUserHomeTimelineCacheMax: 800,
		perLocalUserUserTimelineCacheMax: 800,
		perRemoteUserUserTimelineCacheMax: 800,
		blockedHosts: [] as string[],
		sensitiveWords: [] as string[],
		prohibitedWords: [] as string[],
	} as MiMeta;
	const meta = { ...metaInitial };

	function updateMeta(newMeta: Partial<MiMeta>): void {
		for (const key in meta) {
			delete (meta as any)[key];
		}
		Object.assign(meta, newMeta);
	}

	beforeAll(async () => {
		const app = await Test.createTestingModule({
			imports: [GlobalModule, CoreModule],
		})
			.overrideProvider(DownloadService).useValue({
				async downloadUrl(): Promise<{ filename: string }> {
					return {
						filename: 'dummy.tmp',
					};
				},
			})
			.overrideProvider(DI.meta).useFactory({ factory: () => meta })
			.compile();

		await app.init();
		app.enableShutdownHooks();

		userProfilesRepository = app.get(DI.userProfilesRepository);

		noteService = app.get<ApNoteService>(ApNoteService);
		personService = app.get<ApPersonService>(ApPersonService);
		rendererService = app.get<ApRendererService>(ApRendererService);
		imageService = app.get<ApImageService>(ApImageService);
		jsonLdService = app.get<JsonLdService>(JsonLdService);
		resolver = new MockResolver(await app.resolve<LoggerService>(LoggerService));
		idService = app.get<IdService>(IdService);
		userPublickeysRepository = app.get<UserPublickeysRepository>(DI.userPublickeysRepository);

		// Prevent ApPersonService from fetching instance, as it causes Jest import-after-test error
		const federatedInstanceService = app.get<FederatedInstanceService>(FederatedInstanceService);
		jest.spyOn(federatedInstanceService, 'fetch').mockImplementation(() => new Promise(() => { }));
	});

	beforeEach(() => {
		resolver.clear();
	});

	describe('Parse minimum object', () => {
		const actor = createRandomActor();

		const post = {
			'@context': 'https://www.w3.org/ns/activitystreams',
			id: `${host}/users/${secureRndstr(8)}`,
			type: 'Note',
			attributedTo: actor.id,
			to: 'https://www.w3.org/ns/activitystreams#Public',
			content: 'あ',
		};

		test('Minimum Actor', async () => {
			resolver.register(actor.id, actor);

			const user = await personService.createPerson(actor.id, resolver);

			assert.deepStrictEqual(user.uri, actor.id);
			assert.deepStrictEqual(user.username, actor.preferredUsername);
			assert.deepStrictEqual(user.inbox, actor.inbox);
		});

		test('Minimum Note', async () => {
			resolver.register(actor.id, actor);
			resolver.register(post.id, post);

			const note = await noteService.createNote(post.id, undefined, resolver, true);

			assert.deepStrictEqual(note?.uri, post.id);
			assert.deepStrictEqual(note.visibility, 'public');
			assert.deepStrictEqual(note.text, post.content);
		});
	});

	describe('Name field', () => {
		test('Truncate long name', async () => {
			const actor = {
				...createRandomActor(),
				name: secureRndstr(129),
			};

			resolver.register(actor.id, actor);

			const user = await personService.createPerson(actor.id, resolver);

			assert.deepStrictEqual(user.name, actor.name.slice(0, 128));
		});

		test('Normalize empty name', async () => {
			const actor = {
				...createRandomActor(),
				name: '',
			};

			resolver.register(actor.id, actor);

			const user = await personService.createPerson(actor.id, resolver);

			assert.strictEqual(user.name, null);
		});
	});

	describe('Collection visibility', () => {
		test('Public following/followers', async () => {
			const actor = createRandomActor();
			actor.following = {
				id: `${actor.id}/following`,
				type: 'OrderedCollection',
				totalItems: 0,
				first: `${actor.id}/following?page=1`,
			};
			actor.followers = `${actor.id}/followers`;

			resolver.register(actor.id, actor);
			resolver.register(actor.followers, {
				id: actor.followers,
				type: 'OrderedCollection',
				totalItems: 0,
				first: `${actor.followers}?page=1`,
			});

			const user = await personService.createPerson(actor.id, resolver);
			const userProfile = await userProfilesRepository.findOneByOrFail({ userId: user.id });

			assert.deepStrictEqual(userProfile.followingVisibility, 'public');
			assert.deepStrictEqual(userProfile.followersVisibility, 'public');
		});

		test('Private following/followers', async () => {
			const actor = createRandomActor();
			actor.following = {
				id: `${actor.id}/following`,
				type: 'OrderedCollection',
				totalItems: 0,
				// first: …
			};
			actor.followers = `${actor.id}/followers`;

			resolver.register(actor.id, actor);
			//resolver.register(actor.followers, { … });

			const user = await personService.createPerson(actor.id, resolver);
			const userProfile = await userProfilesRepository.findOneByOrFail({ userId: user.id });

			assert.deepStrictEqual(userProfile.followingVisibility, 'private');
			assert.deepStrictEqual(userProfile.followersVisibility, 'private');
		});
	});

	describe('Renderer', () => {
		test('Render an announce with visibility: followers', () => {
			rendererService.renderAnnounce('https://example.com/notes/00example', {
				id: genAidx(Date.now()),
				visibility: 'followers',
			} as MiNote);
		});
	});

	describe('Featured', () => {
		test('Fetch featured notes from IActor', async () => {
			const actor = createRandomActor();
			actor.featured = `${actor.id}/collections/featured`;

			const featured = createRandomFeaturedCollection(actor, 5);

			resolver.register(actor.id, actor);
			resolver.register(actor.featured, featured);

			await personService.createPerson(actor.id, resolver);

			// All notes in `featured` are same-origin, no need to fetch notes again
			assert.deepStrictEqual(resolver.remoteGetTrials(), [actor.id, `${actor.id}/outbox`, actor.featured]);

			// Created notes without resolving anything
			for (const item of featured.items as IPost[]) {
				const note = await noteService.fetchNote(item);
				assert.ok(note);
				assert.strictEqual(note.text, 'test test foo');
				assert.strictEqual(note.uri, item.id);
			}
		});

		test('Fetch featured notes from IActor pointing to another remote server', async () => {
			const actor1 = createRandomActor();
			actor1.featured = `${actor1.id}/collections/featured`;
			const actor2 = createRandomActor({ actorHost: 'https://host2.test' });

			const actor2Note = createRandomNote(actor2);
			const featured = createRandomFeaturedCollection(actor1, 0);
			(featured.items as IPost[]).push({
				...actor2Note,
				content: 'test test bar', // fraud!
			});

			resolver.register(actor1.id, actor1);
			resolver.register(actor1.featured, featured);
			resolver.register(actor2.id, actor2);
			resolver.register(actor2Note.id, actor2Note);

			await personService.createPerson(actor1.id, resolver);

			// actor2Note is from a different server and needs to be fetched again
			assert.deepStrictEqual(
				resolver.remoteGetTrials(),
				[actor1.id, `${actor1.id}/outbox`, actor1.featured, actor2Note.id, actor2.id, `${actor2.id}/outbox`],
			);

			const note = await noteService.fetchNote(actor2Note.id);
			assert.ok(note);

			// Reflects the original content instead of the fraud
			assert.strictEqual(note.text, 'test test foo');
			assert.strictEqual(note.uri, actor2Note.id);
		});

		test('Fetch a note that is a featured note of the attributed actor', async () => {
			const actor = createRandomActor();
			actor.featured = `${actor.id}/collections/featured`;

			const featured = createRandomFeaturedCollection(actor, 5);
			const firstNote = (featured.items as NonTransientIPost[])[0];

			resolver.register(actor.id, actor);
			resolver.register(actor.featured, featured);
			resolver.register(firstNote.id, firstNote);

			const note = await noteService.createNote(firstNote.id as string, undefined, resolver);
			assert.strictEqual(note?.uri, firstNote.id);
		});
	});

	describe('Images', () => {
		test('Create images', async () => {
			const imageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/foo.png',
				name: '',
			};
			const driveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				imageObject,
			);
			assert.ok(driveFile && !driveFile.isLink);

			const sensitiveImageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/bar.png',
				name: '',
				sensitive: true,
			};
			const sensitiveDriveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				sensitiveImageObject,
			);
			assert.ok(sensitiveDriveFile && !sensitiveDriveFile.isLink);
		});

		test('cacheRemoteFiles=false disables caching', async () => {
			updateMeta({ ...metaInitial, cacheRemoteFiles: false });

			const imageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/foo.png',
				name: '',
			};
			const driveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				imageObject,
			);
			assert.ok(driveFile && driveFile.isLink);

			const sensitiveImageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/bar.png',
				name: '',
				sensitive: true,
			};
			const sensitiveDriveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				sensitiveImageObject,
			);
			assert.ok(sensitiveDriveFile && sensitiveDriveFile.isLink);
		});

		test('cacheRemoteSensitiveFiles=false only affects sensitive files', async () => {
			updateMeta({ ...metaInitial, cacheRemoteSensitiveFiles: false });

			const imageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/foo.png',
				name: '',
			};
			const driveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				imageObject,
			);
			assert.ok(driveFile && !driveFile.isLink);

			const sensitiveImageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/bar.png',
				name: '',
				sensitive: true,
			};
			const sensitiveDriveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				sensitiveImageObject,
			);
			assert.ok(sensitiveDriveFile && sensitiveDriveFile.isLink);
		});

		test('Link is not an attachment files', async () => {
			const linkObject: IObject = {
				type: 'Link',
				href: 'https://example.com/',
			};
			const driveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				linkObject,
			);
			assert.strictEqual(driveFile, null);
		});
	});

	describe('JSON-LD', () => {
		test('Compaction', async () => {
			const jsonLd = jsonLdService.use();

			const object = {
				'@context': [
					'https://www.w3.org/ns/activitystreams',
					{
						_misskey_quote: 'https://misskey-hub.net/ns#_misskey_quote',
						unknown: 'https://example.org/ns#unknown',
						undefined: null,
					},
				],
				id: 'https://example.com/notes/42',
				type: 'Note',
				attributedTo: 'https://example.com/users/1',
				to: ['https://www.w3.org/ns/activitystreams#Public'],
				content: 'test test foo',
				_misskey_quote: 'https://example.com/notes/1',
				unknown: 'test test bar',
				undefined: 'test test baz',
			};
			const compacted = await jsonLd.compact(object);

			assert.deepStrictEqual(compacted, {
				'@context': CONTEXT,
				id: 'https://example.com/notes/42',
				type: 'Note',
				attributedTo: 'https://example.com/users/1',
				to: 'as:Public',
				content: 'test test foo',
				_misskey_quote: 'https://example.com/notes/1',
				'https://example.org/ns#unknown': 'test test bar',
				// undefined: 'test test baz',
			});
		});
	});

	describe(ApRendererService, () => {
		let note: MiNote;
		let author: MiUser;

		beforeEach(() => {
			author = new MiUser({
				id: idService.gen(),
			});
			note = new MiNote({
				id: idService.gen(),
				userId: author.id,
				visibility: 'public',
				localOnly: false,
				text: 'Note text',
				cw: null,
				renoteCount: 0,
				repliesCount: 0,
				clippedCount: 0,
				reactions: {},
				fileIds: [],
				attachedFileTypes: [],
				visibleUserIds: [],
				mentions: [],
				// This is fucked tbh - it's JSON stored in a TEXT column that gets parsed/serialized all over the place
				mentionedRemoteUsers: '[]',
				reactionAndUserPairCache: [],
				emojis: [],
				tags: [],
				hasPoll: false,
			});
		});

		describe('renderNote', () => {
			describe('summary', () => {
				// I actually don't know why it does this, but the logic was already there so I've preserved it.
				it('should be zero-width space when CW is empty string', async () => {
					note.cw = '';

					const result = await rendererService.renderNote(note, author, false);

					expect(result.summary).toBe(String.fromCharCode(0x200B));
				});

				it('should be undefined when CW is null', async () => {
					const result = await rendererService.renderNote(note, author, false);

					expect(result.summary).toBeUndefined();
				});

				it('should be CW when present without mandatoryCW', async () => {
					note.cw = 'original';

					const result = await rendererService.renderNote(note, author, false);

					expect(result.summary).toBe('original');
				});

				it('should be mandatoryCW when present without CW', async () => {
					author.mandatoryCW = 'mandatory';

					const result = await rendererService.renderNote(note, author, false);

					expect(result.summary).toBe('mandatory');
				});

				it('should be merged when CW and mandatoryCW are both present', async () => {
					note.cw = 'original';
					author.mandatoryCW = 'mandatory';

					const result = await rendererService.renderNote(note, author, false);

					expect(result.summary).toBe('original, mandatory');
				});

				it('should be CW when CW includes mandatoryCW', async () => {
					note.cw = 'original and mandatory';
					author.mandatoryCW = 'mandatory';

					const result = await rendererService.renderNote(note, author, false);

					expect(result.summary).toBe('original and mandatory');
				});
			});
		});

		describe('renderUpnote', () => {
			describe('summary', () => {
				// I actually don't know why it does this, but the logic was already there so I've preserved it.
				it('should be zero-width space when CW is empty string', async () => {
					note.cw = '';

					const result = await rendererService.renderUpNote(note, author, false);

					expect(result.summary).toBe(String.fromCharCode(0x200B));
				});

				it('should be undefined when CW is null', async () => {
					const result = await rendererService.renderUpNote(note, author, false);

					expect(result.summary).toBeUndefined();
				});

				it('should be CW when present without mandatoryCW', async () => {
					note.cw = 'original';

					const result = await rendererService.renderUpNote(note, author, false);

					expect(result.summary).toBe('original');
				});

				it('should be mandatoryCW when present without CW', async () => {
					author.mandatoryCW = 'mandatory';

					const result = await rendererService.renderUpNote(note, author, false);

					expect(result.summary).toBe('mandatory');
				});

				it('should be merged when CW and mandatoryCW are both present', async () => {
					note.cw = 'original';
					author.mandatoryCW = 'mandatory';

					const result = await rendererService.renderUpNote(note, author, false);

					expect(result.summary).toBe('original, mandatory');
				});

				it('should be CW when CW includes mandatoryCW', async () => {
					note.cw = 'original and mandatory';
					author.mandatoryCW = 'mandatory';

					const result = await rendererService.renderUpNote(note, author, false);

					expect(result.summary).toBe('original and mandatory');
				});
			});
		});
	});

	describe(ApPersonService, () => {
		describe('createPerson', () => {
			it('should trim publicKey', async () => {
				const actor = createRandomActor();
				actor.publicKey = {
					id: `${actor.id}#main-key`,
					publicKeyPem: '  key material\t\n\r\n \n',
				};
				resolver.register(actor.id, actor);

				const user = await personService.createPerson(actor.id, resolver);
				const publicKey = await userPublickeysRepository.findOneBy({ userId: user.id });

				expect(publicKey).not.toBeNull();
				expect(publicKey?.keyPem).toBe('key material');
			});

			it('should accept SocialHome actor', async () => {
				// This is taken from a real SocialHome actor, including the 13,905 newline characters in the public key.
				const actor = {
					'@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1', {
						'pyfed': 'https://docs.jasonrobinson.me/ns/python-federation#',
						'diaspora': 'https://diasporafoundation.org/ns/',
						'manuallyApprovesFollowers': 'as:manuallyApprovesFollowers',
					}],
					id: 'https://socialhome.network/u/hq/',
					type: 'Person',
					inbox: 'https://socialhome.network/u/hq/inbox/',
					'diaspora:guid': '7538bd1b-d3a8-49a5-bf00-db63fcc9114f',
					'diaspora:handle': 'hq@socialhome.network',
					publicKey: {
						id: 'https://socialhome.network/u/hq/#main-key',
						owner: 'https://socialhome.network/u/hq/',
						publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAg39sDmTAJ7l9bl5jYLmj\nKYnDZJgRiO/WR+V1HEMEsRoEPTxJzWe+Ou7YTUhOOvDRu5ncEn3ictF3/BxhhQC1\nQwUKYlfuU1R7PyGqWtGm6300mDAmbq+eyC+fwV9FbkCm9npRatZfnZXZWuCgA6f7\nWmmBw09QVZQ6Ypu+7CF/Q6bv0E5B2hieTSbRgavdSkEopMyJhPs5/X6Hh4XYSi7t\nYEg9vD0d0J9QJSnCTYIZT145cV1DANV/4KjhKkYgvt4hLNOKZ1v4QC57K+PFna9N\ntxm1nMxwjpBPus8LQeDii/MwKoiZ7LBjeflm0C9AMFlNPB9iq3rEXo3eyCEb7Lyr\nEp+oqYNfopFIRPNfhBxtkx5ioUXty3cx1WnZtehqGdpOcb1wUatW5IjV8tlfLIr7\nrDNCxgGnScR6h7++BHYDdDVBgGUkC5ELIxxSMqlYMiBGVmYdIoAGO6nuqw4bp5l3\nUf07d28GoZgcRBVZWC/xOtRb7E6PTzsE7xd51UijusRC79lnapzTWY9GAY0ZYu+w\nbAxO7u3+Knr6EXZkGkmrElKIT2N6SPJY3Xo91+PT1Y77JMFkkWlEX9IO08fALsqg\nbMSKNQ8WfyHCTjaiH3n4BdgTjP4kRm2OhczxvgCFvtcOK+M60YdwM6MOZDEOVtGU\nGIYA1mtQW7a8jb5QPTQu9GcCAwEAAQ==\n-----END PUBLIC KEY-----' + ''.padEnd(13905, '\n'),
					},
					endpoints: { 'sharedInbox': 'https://socialhome.network/receive/public/' },
					followers: 'https://socialhome.network/u/hq/followers/',
					following: 'https://socialhome.network/u/hq/following/',
					icon: {
						type: 'Image',
						'pyfed:inlineImage': false,
						mediaType: 'image/png',
						url: 'https://socialhome.network/media/__sized__/profiles/Socialhome-dark-600-crop-c0-5__0-5-300x300.png',
					},
					manuallyApprovesFollowers: false,
					name: 'Socialhome HQ',
					outbox: 'https://socialhome.network/u/hq/outbox/',
					preferredUsername: 'hq',
					published: '2017-01-29T19:28:19+00:00',
					updated: '2025-02-17T23:11:30+00:00',
					url: 'https://socialhome.network/p/7538bd1b-d3a8-49a5-bf00-db63fcc9114f/',
				};
				resolver.register(actor.id, actor);
				resolver.register(actor.publicKey.id, actor.publicKey);
				resolver.register(actor.followers, { id: actor.followers, type: 'Collection', totalItems: 0, items: [] } satisfies ICollection);
				resolver.register(actor.following, { id: actor.following, type: 'Collection', totalItems: 0, items: [] } satisfies ICollection);
				resolver.register(actor.outbox, { id: actor.outbox, type: 'Collection', totalItems: 0, items: [] } satisfies ICollection);

				const user = await personService.createPerson(actor.id, resolver);
				const publicKey = await userPublickeysRepository.findOneBy({ userId: user.id });

				expect(user.uri).toBe(actor.id);
				expect(publicKey).not.toBeNull();
			});
		});
	});
});
