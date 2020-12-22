import * as vscode from 'vscode';
// import * as path from 'path';
import { GitHubRef } from '../common/githubRef';
import { Remote } from '../common/remote';
import { AzdoRepository } from './azdoRepository';
import { ITelemetry } from '../common/telemetry';
import { ICommentPermissions, IRawFileChange, PullRequest, PullRequestVote } from './interface';
import { CommentThreadStatus, CommentType, GitPullRequestCommentThread, GitPullRequestCommentThreadContext, PullRequestStatus, Comment, IdentityRefWithVote, GitCommitRef, GitChange, GitBaseVersionDescriptor, GitVersionOptions, GitVersionType, GitCommitDiffs, FileDiffParams, FileDiff, VersionControlChangeType } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { convertAzdoPullRequestToRawPullRequest, readableToString } from './utils';
import Logger from '../common/logger';
import { formatError } from '../common/utils';
// import { PullRequest, GithubItemStateEnum, ISuggestedReviewer, PullRequestChecks, IAccount, IRawFileChange, PullRequestMergeability, PullRequestStatus } from './interface';
// import { isReviewEvent, ReviewEvent as CommonReviewEvent, TimelineEvent } from '../common/timelineEvent';
// import { ReviewEvent } from './interface';
// import { convertPullRequestsGetCommentsResponseItemToComment, convertRESTPullRequestToRawPullRequest, convertRESTReviewEvent, convertRESTUserToAccount, parseGraphQLComment, parseGraphQLReviewEvent, parseGraphQLTimelineEvents, parseMergeability } from './utils';
// import { AddCommentResponse, DeleteReviewResponse, EditCommentResponse, GetChecksResponse, isCheckRun, MarkPullRequestReadyForReviewResponse, PendingReviewIdResponse, PullRequestCommentsResponse, PullRequestResponse, StartReviewResponse, SubmitReviewResponse, TimelineEventsResponse } from './graphql';
// import Logger from '../common/logger';
// import { IComment } from '../common/comment';
// import { formatError } from '../common/utils';
// import { toPRUri, toReviewUri } from '../common/uri';
// import { parseDiff } from '../common/diffHunk';
// import { GitChangeType } from '../common/file';
// import { FolderRepositoryManager } from './folderRepositoryManager';

interface IPullRequestModel {
	head: GitHubRef | null;
}

export interface IResolvedPullRequestModel extends IPullRequestModel {
	head: GitHubRef;
}

// interface NewCommentPosition {
// 	path: string;
// 	position: number;
// }

// interface ReplyCommentPosition {
// 	inReplyTo: string;
// }

export class PullRequestModel implements IPullRequestModel {
	static ID = 'PullRequestModel';

	public isDraft?: boolean;
	public localBranchName?: string;
	public mergeBase?: string;
	private _hasPendingReview: boolean = false;
	private _onDidChangePendingReviewState: vscode.EventEmitter<boolean> = new vscode.EventEmitter<boolean>();
	public onDidChangePendingReviewState = this._onDidChangePendingReviewState.event;

	// Whether the pull request is currently checked out locally
	public isActive: boolean;
	_telemetry: ITelemetry;
	public state: PullRequestStatus = PullRequestStatus.NotSet;

	constructor(telemetry: ITelemetry, private azdoRepository: AzdoRepository, remote: Remote, public item: PullRequest, isActive?: boolean) {
		// TODO: super.update was changing state of the issue and initializing some variable.
		// super(azdoRepository, remote, item);

		this._telemetry = telemetry;

		this.isActive = isActive === undefined ? item.status === PullRequestStatus.Active: false;
		this.update(item);
	}

	public get isMerged(): boolean {
		return this.state === PullRequestStatus.Completed;
	}

	public get hasPendingReview(): boolean {
		return this._hasPendingReview;
	}

	public set hasPendingReview(hasPendingReview: boolean) {
		if (this._hasPendingReview !== hasPendingReview) {
			this._hasPendingReview = hasPendingReview;
			this._onDidChangePendingReviewState.fire(this._hasPendingReview);
		}
	}

	public head: GitHubRef;
	public base: GitHubRef;

	protected updateState(state: string) {
		if (state.toLowerCase() === 'active') {
			this.state = PullRequestStatus.Active;
		} else if (state.toLowerCase() === 'abandoned') {
			this.state = PullRequestStatus.Abandoned;
		} else {
			this.state = PullRequestStatus.Completed;
		}
	}

	update(item: PullRequest): void {
		// TODO: super.update was changing state of the issue and initializing some variable.
		// super.update(item);
		this.isDraft = item.isDraft;

		if (item.head && item.head.exists) {
			this.head = new GitHubRef(item.head.ref, '', item.head.sha, item.head.repo.cloneUrl);
		}

		if (item.base && item.base.exists) {
			this.base = new GitHubRef(item.base.ref, '', item.base.sha, item.base.repo.cloneUrl);
		}
	}

	/**
	 * Validate if the pull request has a valid HEAD.
	 * Use only when the method can fail silently, otherwise use `validatePullRequestModel`
	 */
	isResolved(): this is IResolvedPullRequestModel {
		return !!this.head;
	}

	getPullRequestId(): number {
		return this.item.pullRequestId || -1;
	}

	/**
	 * Validate if the pull request has a valid HEAD. Show a warning message to users when the pull request is invalid.
	 * @param message Human readable action execution failure message.
	 */
	validatePullRequestModel(message?: string): this is IResolvedPullRequestModel {
		if (!!this.head) {
			return true;
		}

		const reason = `There is no upstream branch for Pull Request #${this.getPullRequestId()}. View it on Azure Devops for more details`;

		if (message) {
			message += `: ${reason}`;
		} else {
			message = reason;
		}

		vscode.window.showWarningMessage(message, 'Open in Azure Devops').then(action => {
			if (action && action === 'Open in Azure Devops') {
				vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(this.item.url || ''));
			}
		});

		return false;
	}

	// /**
	//  * Approve the pull request.
	//  * @param message Optional approval comment text.
	//  */
	// async approve(message?: string): Promise<CommonReviewEvent> {
	// 	const action: Promise<CommonReviewEvent> = await this.getPendingReviewId()
	// 		? this.submitReview(ReviewEvent.Approve, message)
	// 		: this.createReview(ReviewEvent.Approve, message);

	// 	return action.then(x => {
	// 		/* __GDPR__
	// 			"pr.approve" : {}
	// 		*/
	// 		this._telemetry.sendTelemetryEvent('pr.approve');
	// 		return x;
	// 	});
	// }

	// /**
	//  * Request changes on the pull request.
	//  * @param message Optional comment text to leave with the review.
	//  */
	// async requestChanges(message?: string): Promise<CommonReviewEvent> {
	// 	const action: Promise<CommonReviewEvent> = await this.getPendingReviewId()
	// 		? this.submitReview(ReviewEvent.RequestChanges, message)
	// 		: this.createReview(ReviewEvent.RequestChanges, message);

	// 	return action
	// 		.then(x => {
	// 			/* __GDPR__
	// 				"pr.requestChanges" : {}
	// 			*/
	// 			this._telemetry.sendTelemetryEvent('pr.requestChanges');
	// 			return x;
	// 		});
	// }

	/**
	 * Close the pull request.
	 */
	async abandon(): Promise<PullRequest> {
		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId();
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();
		const ret = await git?.updatePullRequest({ status: PullRequestStatus.Abandoned }, repoId || '', this.getPullRequestId());

		if (ret === undefined) {
			Logger.debug('Update pull request did not return a valid PR', PullRequestModel.ID);
			return this.item;
		}

		/* __GDPR__
			"pr.close" : {}
		*/
		this._telemetry.sendTelemetryEvent('pr.close');

		return convertAzdoPullRequestToRawPullRequest(ret, this.azdoRepository);
	}

	async createThread(
		message?: string,
		threadContext?: {filePath: string, line: number, startOffset: number, endOffset: number},
		prCommentThreadContext?: GitPullRequestCommentThreadContext): Promise<GitPullRequestCommentThread | undefined> {

		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId() || '';
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();

		const thread: GitPullRequestCommentThread = {
			comments: [
				{
					commentType: CommentType.Text,
					parentCommentId: 0,
					content: message
				}
			],
			status: CommentThreadStatus.Active,
			threadContext: {
				filePath: threadContext?.filePath,
				rightFileStart: { line: threadContext?.line, offset: threadContext?.startOffset },
				rightFileEnd: { line: threadContext?.line, offset: threadContext?.endOffset }
			},
			pullRequestThreadContext: prCommentThreadContext
		};

		return await git?.createThread(thread, repoId, this.getPullRequestId());
	}

	async updateThreadStatus(threadId: number, status: CommentThreadStatus, prCommentThreadContext?: GitPullRequestCommentThreadContext): Promise<GitPullRequestCommentThread | undefined> {
		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId() || '';
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();

		const thread: GitPullRequestCommentThread = {
			status,
			pullRequestThreadContext: prCommentThreadContext
		};

		return await git?.updateThread(thread, repoId, this.getPullRequestId(), threadId);
	}

	async getAllThreads(iteration?: number, baseIteration?: number): Promise<GitPullRequestCommentThread[] | undefined> {
		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId() || '';
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();

		return await git?.getThreads(repoId, this.getPullRequestId(), undefined, iteration, baseIteration);
	}

	async createCommentOnThread(threadId: number, message: string, parentCommentId?: number): Promise<Comment | undefined> {
		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId() || '';
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();

		const comment: Comment = {
			commentType: CommentType.Text,
			parentCommentId: parentCommentId,
			content: message
		};

		return await git?.createComment(comment, repoId, this.getPullRequestId(), threadId);
	}

	async getCommentsOnThread(threadId: number): Promise<Comment[] | undefined> {
		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId() || '';
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();

		return await git?.getComments(repoId, this.getPullRequestId(), threadId);
	}

	async submitVote(vote: PullRequestVote): Promise<IdentityRefWithVote | undefined> {
		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId() || '';
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();

		return await git?.createPullRequestReviewer({ vote: vote }, repoId, this.getPullRequestId(), azdo?.authenticatedUser?.id || '');
	}

	async editThread(message: string, threadId: number, commentId: number, prCommentThreadContext?: GitPullRequestCommentThreadContext): Promise<Comment | undefined> {
		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId() || '';
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();

		const comment: Comment = {
			id: commentId,
			content: message,
		};

		return await git?.updateComment(comment, repoId, this.getPullRequestId(), threadId, commentId);
	}

	getCommentPermission(comment: Comment): ICommentPermissions {
		const user = this.azdoRepository.azdo?.authenticatedUser;
		const isSameUser = comment.author?.id === user?.id;

		return {
			canDelete: isSameUser ?? false,
			canEdit: isSameUser ?? false
		};
	}

	async getCommits(forceRefresh?: boolean): Promise<GitCommitRef[]> {
		Logger.debug(`Fetch commits of PR #${this.getPullRequestId()} - enter`, PullRequestModel.ID);
		let commits = this.item.commits;

		if (!!commits && !forceRefresh) {
			Logger.debug(`Fetch commits of PR #${this.getPullRequestId()} - cache hit`, PullRequestModel.ID);
			return commits;
		}

		try {
			Logger.debug(`Fetch commits of PR #${this.getPullRequestId()} - Cache hit failed`, PullRequestModel.ID);

			const azdoRepo = await this.azdoRepository.ensure();
			const repoId = await azdoRepo.getRepositoryId() || '';
			const azdo = azdoRepo.azdo;
			const git = await azdo?.connection.getGitApi();

			commits = await git?.getPullRequestCommits(repoId, this.getPullRequestId());
			this.item.commits = commits ?? [];

			Logger.debug(`Fetch commits of PR #${this.getPullRequestId()} - done`, PullRequestModel.ID);
			return this.item.commits;
		} catch (e) {
			vscode.window.showErrorMessage(`Fetching commits failed: ${formatError(e)}`);
			return [];
		}
	}

	/**
	 * Get all changed files within a commit
	 * @param commit The commit
	 */
	async getCommitChanges(commit: Partial<GitCommitRef>, forceRefresh?: boolean): Promise<GitChange[]> {
		try {
			Logger.debug(`Fetch file changes of commit ${commit.commitId} in PR #${this.getPullRequestId()} - enter`, PullRequestModel.ID);

			if (!!commit.changes && !forceRefresh) {
				Logger.debug(`Fetch file changes of commit ${commit.commitId} in PR #${this.getPullRequestId()} - cache hit`, PullRequestModel.ID);
				return commit.changes;
			}

			const azdoRepo = await this.azdoRepository.ensure();
			const repoId = await azdoRepo.getRepositoryId() || '';
			const azdo = azdoRepo.azdo;
			const git = await azdo?.connection.getGitApi();

			const changes = await git?.getChanges(commit.commitId || '', repoId);
			commit.changes = changes?.changes;
			Logger.debug(`Fetch file changes of commit ${commit.commitId} in PR #${this.getPullRequestId()} - done`, PullRequestModel.ID);

			return commit.changes || [];
		} catch (e) {
			vscode.window.showErrorMessage(`Fetching commit changes failed: ${formatError(e)}`);
			return [];
		}
	}

	/**
	 * Gets file content for a file at the specified commit
	 * @param sha The sha of the file
	 */
	async getFile(sha: string) {
		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId() || '';
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();

		const fileStream = await git?.getBlobContent(repoId, sha);

		const fileContent = readableToString(fileStream);
		return fileContent;
	}

	async getCommitDiffs(base:GitBaseVersionDescriptor, target: GitBaseVersionDescriptor): Promise<GitCommitDiffs | undefined> {
		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId() || '';
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();

		return await git?.getCommitDiffs(repoId, undefined, undefined, undefined, undefined, base, target);
	}

	async getFileDiff(baseVersionCommit: string, targetVersionCommit: string, fileDiffParams: FileDiffParams[]): Promise<FileDiff[]> {
		const azdoRepo = await this.azdoRepository.ensure();
		const repoId = await azdoRepo.getRepositoryId() || '';
		const azdo = azdoRepo.azdo;
		const git = await azdo?.connection.getGitApi();

		return git!.getFileDiffs({
				baseVersionCommit: baseVersionCommit,
				targetVersionCommit: targetVersionCommit,
				fileDiffParams: fileDiffParams},
			this.azdoRepository.azdo!.projectName,
			repoId);
	}

	/**
	 * List the changed files in a pull request.
	 */
	async getFileChangesInfo(): Promise<IRawFileChange[]> {
		Logger.debug(`Fetch file changes, base, head and merge base of PR #${this.getPullRequestId()} - enter`, PullRequestModel.ID);

		if (!this.base) {
			this.update(this.item);
		}

		// baseVersion does not work. So using version.
		const target: GitBaseVersionDescriptor = { version: this.item.head?.sha, versionOptions: GitVersionOptions.None, versionType: GitVersionType.Commit};
		const base: GitBaseVersionDescriptor = { version: this.item.base?.sha, versionOptions: GitVersionOptions.None, versionType: GitVersionType.Commit};

		if (!this.item.head?.exists) {
			target.version = this.item.lastMergeSourceCommit?.commitId;
			base.version = this.item.lastMergeTargetCommit?.commitId;
		}

		const changes = await this.getCommitDiffs(base, target);
		if (!changes?.changes?.length) {
			Logger.debug(`Fetch file changes, base, head and merge base of PR #${this.getPullRequestId()} - No changes found - done`, PullRequestModel.ID);
			return [];
		}

		const BATCH_SIZE = 10;
		const batches = changes!.changes!.length/BATCH_SIZE;
		const diffsPromises: Promise<FileDiff[]>[] = [];
		for (let i: number = 0; i <=batches; i++) {
			const batchedChanges = changes!.changes.slice(i*BATCH_SIZE, Math.min((i+1)*BATCH_SIZE - 1, changes!.changes!.length - 1));
			// tslint:disable-next-line: no-unused-expression
			batchedChanges;
			diffsPromises.push(this.getFileDiff(base.version!, target.version!, this.getFileDiffParamsFromChanges(batchedChanges)));
		}

		const diffsPromisesResult = await Promise.all(diffsPromises);

		const result: IRawFileChange[] = [];

		for (const _diff of ([] as FileDiff[]).concat(...diffsPromisesResult)) { // flatten
			// result.push({
			// 	diffHunk:
			// })
		}
		return result;
	}

	private getFileDiffParamsFromChanges(changes: GitChange[]): FileDiffParams[] {
		return changes.filter(change => change.changeType !== VersionControlChangeType.None).map(change => {
			const params: FileDiffParams = { path: '', originalPath: '' };
			// tslint:disable-next-line: no-bitwise
			if (change.changeType! & VersionControlChangeType.Rename & change.changeType! & VersionControlChangeType.Edit) {
				params.path = change.item!.path;
				params.originalPath = changes.filter(c => c.item?.originalObjectId === change.item?.originalObjectId).pop()?.item?.path || '';
			} if (change.changeType! === VersionControlChangeType.Rename) {
				params.path = change.item!.path;
			} else if (change.changeType! === VersionControlChangeType.Edit) {
				params.path = change.item!.path;
				params.originalPath = change.item?.path;
			} else if (change.changeType! === VersionControlChangeType.Add) {
				params.path = change.item!.path;
			// tslint:disable-next-line: no-bitwise
			} else if (change.changeType! & VersionControlChangeType.Delete) {
				params.originalPath = change.item!.path;
			}
			return params;
		});
	}

	// /**
	//  * Create a new review.
	//  * @param event The type of review to create, an approval, request for changes, or comment.
	//  * @param message The summary comment text.
	//  */
	// private async createReview(event: ReviewEvent, message?: string): Promise<CommonReviewEvent> {
	// 	const { octokit, remote } = await this.githubRepository.ensure();

	// 	const { data } = await octokit.pulls.createReview({
	// 		owner: remote.owner,
	// 		repo: remote.repositoryName,
	// 		pull_number: this.number,
	// 		event: event,
	// 		body: message,
	// 	});

	// 	return convertRESTReviewEvent(data, this.githubRepository);
	// }

	// /**
	//  * Submit an existing review.
	//  * @param event The type of review to create, an approval, request for changes, or comment.
	//  * @param body The summary comment text.
	//  */
	// async submitReview(event?: ReviewEvent, body?: string): Promise<CommonReviewEvent> {
	// 	const pendingReviewId = await this.getPendingReviewId();
	// 	const { mutate, schema } = await this.githubRepository.ensure();

	// 	if (pendingReviewId) {
	// 		const { data } = await mutate<SubmitReviewResponse>({
	// 			mutation: schema.SubmitReview,
	// 			variables: {
	// 				id: pendingReviewId,
	// 				event: event || ReviewEvent.Comment,
	// 				body
	// 			}
	// 		});

	// 		this.hasPendingReview = false;
	// 		await this.updateDraftModeContext();

	// 		return parseGraphQLReviewEvent(data!.submitPullRequestReview.pullRequestReview, this.githubRepository);
	// 	} else {
	// 		throw new Error(`Submitting review failed, no pending review for current pull request: ${this.number}.`);
	// 	}
	// }

	// /**
	//  * Query to see if there is an existing review.
	//  */
	// async getPendingReviewId(): Promise<string | undefined> {
	// 	const { query, schema } = await this.githubRepository.ensure();
	// 	const currentUser = await this.githubRepository.getAuthenticatedUser();
	// 	try {
	// 		const { data } = await query<PendingReviewIdResponse>({
	// 			query: schema.GetPendingReviewId,
	// 			variables: {
	// 				pullRequestId: this.item.graphNodeId,
	// 				author: currentUser
	// 			}
	// 		});
	// 		return data.node.reviews.nodes[0].id;
	// 	} catch (error) {
	// 		return;
	// 	}
	// }

	// /**
	//  * Delete an existing in progress review.
	//  */
	// async deleteReview(): Promise<{ deletedReviewId: number, deletedReviewComments: IComment[] }> {
	// 	const pendingReviewId = await this.getPendingReviewId();
	// 	const { mutate, schema } = await this.githubRepository.ensure();
	// 	const { data } = await mutate<DeleteReviewResponse>({
	// 		mutation: schema.DeleteReview,
	// 		variables: {
	// 			input: { pullRequestReviewId: pendingReviewId }
	// 		}
	// 	});

	// 	const { comments, databaseId } = data!.deletePullRequestReview.pullRequestReview;

	// 	this.hasPendingReview = false;
	// 	await this.updateDraftModeContext();

	// 	return {
	// 		deletedReviewId: databaseId,
	// 		deletedReviewComments: comments.nodes.map(parseGraphQLComment)
	// 	};
	// }

	// /**
	//  * Start a new review.
	//  * @param initialComment The comment text and position information to begin the review with
	//  * @param commitId The optional commit id to start the review on. Defaults to using the current head commit.
	//  */
	// async startReview(initialComment: { body: string, path: string, position: number }, commitId?: string): Promise<IComment> {
	// 	const { mutate, schema } = await this.githubRepository.ensure();
	// 	const { data } = await mutate<StartReviewResponse>({
	// 		mutation: schema.StartReview,
	// 		variables: {
	// 			input: {
	// 				body: '',
	// 				pullRequestId: this.item.graphNodeId,
	// 				comments: initialComment,
	// 				commitOID: commitId || this.head?.sha
	// 			}
	// 		}
	// 	});

	// 	if (!data) {
	// 		throw new Error('Failed to start review');
	// 	}

	// 	this.hasPendingReview = true;
	// 	await this.updateDraftModeContext();

	// 	return parseGraphQLComment(data.addPullRequestReview.pullRequestReview.comments.nodes[0]);
	// }

	// /**
	//  * Create a new review comment. Adds to an existing review if there is one or creates a single review comment.
	//  * @param body The text of the new comment
	//  * @param commentPath The file path where the comment should be made
	//  * @param position The line number within the file to add the comment
	//  * @param commitId The optional commit id to comment on. Defaults to using the current head commit.
	//  */
	// async createReviewComment(body: string, commentPath: string, position: number, commitId?: string): Promise<IComment | undefined> {
	// 	if (!this.validatePullRequestModel('Creating comment failed')) {
	// 		return;
	// 	}

	// 	const pendingReviewId = await this.getPendingReviewId();
	// 	if (pendingReviewId) {
	// 		return this.addCommentToPendingReview(pendingReviewId, body, { path: commentPath, position }, commitId);
	// 	}

	// 	const githubRepository = this.githubRepository;
	// 	const { octokit, remote } = await githubRepository.ensure();

	// 	try {
	// 		const ret = await octokit.pulls.createReviewComment({
	// 			owner: remote.owner,
	// 			repo: remote.repositoryName,
	// 			pull_number: this.number,
	// 			body: body,
	// 			commit_id: commitId || this.head.sha,
	// 			path: commentPath,
	// 			position: position
	// 		});

	// 		return this.addCommentPermissions(convertPullRequestsGetCommentsResponseItemToComment(ret.data, githubRepository));
	// 	} catch (e) {
	// 		throw formatError(e);
	// 	}
	// }

	// /**
	//  * Creates a review comment in reply to an existing review comment.
	//  * @param body The text of the new comment
	//  * @param reply_to The comment to reply to
	//  */
	// async createReviewCommentReply(body: string, reply_to: IComment): Promise<IComment | undefined> {
	// 	const pendingReviewId = await this.getPendingReviewId();
	// 	if (pendingReviewId) {
	// 		return this.addCommentToPendingReview(pendingReviewId, body, { inReplyTo: reply_to.graphNodeId });
	// 	}

	// 	const { octokit, remote } = await this.githubRepository.ensure();

	// 	try {
	// 		const ret = await octokit.pulls.createReplyForReviewComment({
	// 			owner: remote.owner,
	// 			repo: remote.repositoryName,
	// 			pull_number: this.number,
	// 			body: body,
	// 			comment_id: Number(reply_to.id)
	// 		});

	// 		return this.addCommentPermissions(convertPullRequestsGetCommentsResponseItemToComment(ret.data, this.githubRepository));
	// 	} catch (e) {
	// 		throw formatError(e);
	// 	}
	// }

	// private async addCommentToPendingReview(reviewId: string, body: string, position: NewCommentPosition | ReplyCommentPosition, commitId?: string): Promise<IComment> {
	// 	const { mutate, schema } = await this.githubRepository.ensure();
	// 	const { data } = await mutate<AddCommentResponse>({
	// 		mutation: schema.AddComment,
	// 		variables: {
	// 			input: {
	// 				pullRequestReviewId: reviewId,
	// 				body,
	// 				...position,
	// 				commitOID: commitId || this.head?.sha
	// 			}
	// 		}
	// 	});

	// 	const { comment } = data!.addPullRequestReviewComment;
	// 	return parseGraphQLComment(comment);
	// }

	// /**
	//  * Check whether there is an existing pending review and update the context key to control what comment actions are shown.
	//  */
	// async validateDraftMode(): Promise<boolean> {
	// 	const inDraftMode = !!await this.getPendingReviewId();
	// 	if (inDraftMode !== this.hasPendingReview) {
	// 		this.hasPendingReview = inDraftMode;
	// 	}

	// 	await this.updateDraftModeContext();

	// 	return inDraftMode;
	// }

	// private async updateDraftModeContext() {
	// 	if (this.isActive) {
	// 		await vscode.commands.executeCommand('setContext', 'reviewInDraftMode', this.hasPendingReview);
	// 	}
	// }

	// private addCommentPermissions(rawComment: IComment): IComment {
	// 	const isCurrentUser = this.githubRepository.isCurrentUser(rawComment.user!.login);
	// 	const notOutdated = rawComment.position !== null;
	// 	rawComment.canEdit = isCurrentUser && notOutdated;
	// 	rawComment.canDelete = isCurrentUser && notOutdated;

	// 	return rawComment;
	// }

	// /**
	//  * Edit an existing review comment.
	//  * @param comment The comment to edit
	//  * @param text The new comment text
	//  */
	// async editReviewComment(comment: IComment, text: string): Promise<IComment> {
	// 	const { mutate, schema } = await this.githubRepository.ensure();

	// 	const { data } = await mutate<EditCommentResponse>({
	// 		mutation: schema.EditComment,
	// 		variables: {
	// 			input: {
	// 				pullRequestReviewCommentId: comment.graphNodeId,
	// 				body: text
	// 			}
	// 		}
	// 	});

	// 	return parseGraphQLComment(data!.updatePullRequestReviewComment.pullRequestReviewComment);
	// }

	// /**
	//  * Deletes a review comment.
	//  * @param commentId The comment id to delete
	//  */
	// async deleteReviewComment(commentId: string): Promise<void> {
	// 	try {
	// 		const { octokit, remote } = await this.githubRepository.ensure();

	// 		await octokit.pulls.deleteReviewComment({
	// 			owner: remote.owner,
	// 			repo: remote.repositoryName,
	// 			comment_id: Number(commentId)
	// 		});
	// 	} catch (e) {
	// 		throw new Error(formatError(e));
	// 	}
	// }

	// /**
	//  * Get existing requests to review.
	//  */
	// async getReviewRequests(): Promise<IAccount[]> {
	// 	const githubRepository = this.githubRepository;
	// 	const { remote, octokit } = await githubRepository.ensure();
	// 	const result = await octokit.pulls.listRequestedReviewers({
	// 		owner: remote.owner,
	// 		repo: remote.repositoryName,
	// 		pull_number: this.number
	// 	});

	// 	return result.data.users.map((user: any) => convertRESTUserToAccount(user, githubRepository));
	// }

	// /**
	//  * Add reviewers to a pull request
	//  * @param reviewers A list of GitHub logins
	//  */
	// async requestReview(reviewers: string[]): Promise<void> {
	// 	const { octokit, remote } = await this.githubRepository.ensure();
	// 	await octokit.pulls.requestReviewers({
	// 		owner: remote.owner,
	// 		repo: remote.repositoryName,
	// 		pull_number: this.number,
	// 		reviewers
	// 	});
	// }

	// /**
	//  * Remove a review request that has not yet been completed
	//  * @param reviewer A GitHub Login
	//  */
	// async deleteReviewRequest(reviewer: string): Promise<void> {
	// 	const { octokit, remote } = await this.githubRepository.ensure();
	// 	await octokit.pulls.removeRequestedReviewers({
	// 		owner: remote.owner,
	// 		repo: remote.repositoryName,
	// 		pull_number: this.number,
	// 		reviewers: [reviewer]
	// 	});
	// }

	// /**
	//  * Get all review comments.
	//  */
	// async getReviewComments(): Promise<IComment[]> {
	// 	const { remote, query, schema } = await this.githubRepository.ensure();
	// 	try {
	// 		const { data } = await query<PullRequestCommentsResponse>({
	// 			query: schema.PullRequestComments,
	// 			variables: {
	// 				owner: remote.owner,
	// 				name: remote.repositoryName,
	// 				number: this.number,
	// 			}
	// 		});

	// 		const comments = data.repository.pullRequest.reviews.nodes
	// 			.map((node: any) => node.comments.nodes.map((comment: any) => parseGraphQLComment(comment), remote))
	// 			.reduce((prev: any, curr: any) => prev.concat(curr), [])
	// 			.sort((a: IComment, b: IComment) => { return a.createdAt > b.createdAt ? 1 : -1; });

	// 		return comments;
	// 	} catch (e) {
	// 		Logger.appendLine(`Failed to get pull request review comments: ${e}`);
	// 		return [];
	// 	}
	// }

	// /**
	//  * Get a list of the commits within a pull request.
	//  */
	// async getCommits(): Promise<OctokitTypes.PullsListCommitsResponseData> {
	// 	try {
	// 		Logger.debug(`Fetch commits of PR #${this.number} - enter`, PullRequestModel.ID);
	// 		const { remote, octokit } = await this.githubRepository.ensure();
	// 		const commitData = await octokit.pulls.listCommits({
	// 			pull_number: this.number,
	// 			owner: remote.owner,
	// 			repo: remote.repositoryName
	// 		});
	// 		Logger.debug(`Fetch commits of PR #${this.number} - done`, PullRequestModel.ID);

	// 		return commitData.data;
	// 	} catch (e) {
	// 		vscode.window.showErrorMessage(`Fetching commits failed: ${formatError(e)}`);
	// 		return [];
	// 	}
	// }

	// /**
	//  * Get all changed files within a commit
	//  * @param commit The commit
	//  */
	// async getCommitChangedFiles(commit: OctokitTypes.PullsListCommitsResponseData[0]): Promise<OctokitTypes.ReposGetCommitResponseData['files']> {
	// 	try {
	// 		Logger.debug(`Fetch file changes of commit ${commit.sha} in PR #${this.number} - enter`, PullRequestModel.ID);
	// 		const { octokit, remote } = await this.githubRepository.ensure();
	// 		const fullCommit = await octokit.repos.getCommit({
	// 			owner: remote.owner,
	// 			repo: remote.repositoryName,
	// 			ref: commit.sha
	// 		});
	// 		Logger.debug(`Fetch file changes of commit ${commit.sha} in PR #${this.number} - done`, PullRequestModel.ID);

	// 		return fullCommit.data.files.filter(file => !!file.patch);
	// 	} catch (e) {
	// 		vscode.window.showErrorMessage(`Fetching commit file changes failed: ${formatError(e)}`);
	// 		return [];
	// 	}
	// }

	// /**
	//  * Gets file content for a file at the specified commit
	//  * @param filePath The file path
	//  * @param commit The commit
	//  */
	// async getFile(filePath: string, commit: string) {
	// 	const { octokit, remote } = await this.githubRepository.ensure();
	// 	const fileContent = await octokit.repos.getContent({
	// 		owner: remote.owner,
	// 		repo: remote.repositoryName,
	// 		path: filePath,
	// 		ref: commit
	// 	});

	// 	if (Array.isArray(fileContent.data)) {
	// 		throw new Error(`Unexpected array response when getting file ${filePath}`);
	// 	}

	// 	const contents = fileContent.data.content ?? '';
	// 	const buff = new Buffer(contents, <any>fileContent.data.encoding);
	// 	return buff.toString();
	// }

	// /**
	//  * Get the timeline events of a pull request, including comments, reviews, commits, merges, deletes, and assigns.
	//  */
	// async getTimelineEvents(): Promise<TimelineEvent[]> {
	// 	Logger.debug(`Fetch timeline events of PR #${this.number} - enter`, PullRequestModel.ID);
	// 	const { query, remote, schema } = await this.githubRepository.ensure();

	// 	try {
	// 		const { data } = await query<TimelineEventsResponse>({
	// 			query: schema.TimelineEvents,
	// 			variables: {
	// 				owner: remote.owner,
	// 				name: remote.repositoryName,
	// 				number: this.number
	// 			}
	// 		});
	// 		const ret = data.repository.pullRequest.timelineItems.nodes;
	// 		const events = parseGraphQLTimelineEvents(ret, this.githubRepository);
	// 		await this.addReviewTimelineEventComments(events);

	// 		return events;
	// 	} catch (e) {
	// 		console.log(e);
	// 		return [];
	// 	}
	// }

	// private async addReviewTimelineEventComments(events: TimelineEvent[]): Promise<void> {
	// 	interface CommentNode extends IComment {
	// 		childComments?: CommentNode[];
	// 	}

	// 	const reviewEvents = events.filter(isReviewEvent);
	// 	const reviewComments = await this.getReviewComments() as CommentNode[];

	// 	const reviewEventsById = reviewEvents.reduce((index, evt) => {
	// 		index[evt.id] = evt;
	// 		evt.comments = [];
	// 		return index;
	// 	}, {} as { [key: number]: CommonReviewEvent });

	// 	const commentsById = reviewComments.reduce((index, evt) => {
	// 		index[evt.id] = evt;
	// 		return index;
	// 	}, {} as { [key: number]: CommentNode });

	// 	const roots: CommentNode[] = [];
	// 	let i = reviewComments.length; while (i-- > 0) {
	// 		const c: CommentNode = reviewComments[i];
	// 		if (!c.inReplyToId) {
	// 			roots.unshift(c);
	// 			continue;
	// 		}
	// 		const parent = commentsById[c.inReplyToId];
	// 		parent.childComments = parent.childComments || [];
	// 		parent.childComments = [c, ...(c.childComments || []), ...parent.childComments];
	// 	}

	// 	roots.forEach(c => {
	// 		const review = reviewEventsById[c.pullRequestReviewId!];
	// 		if (review) {
	// 			review.comments = review.comments.concat(c).concat(c.childComments || []);
	// 		}
	// 	});

	// 	const pendingReview = reviewEvents.filter(r => r.state.toLowerCase() === 'pending')[0];
	// 	if (pendingReview) {
	// 		// Ensures that pending comments made in reply to other reviews are included for the pending review
	// 		pendingReview.comments = reviewComments.filter(c => c.isDraft);
	// 	}
	// }

	// /**
	//  * Get the status checks of the pull request, those for the last commit.
	//  */
	// async getStatusChecks(): Promise<PullRequestChecks> {
	// 	const { query, remote, schema } = await this.githubRepository.ensure();
	// 	const result = await query<GetChecksResponse>({
	// 		query: schema.GetChecks,
	// 		variables: {
	// 			owner: remote.owner,
	// 			name: remote.repositoryName,
	// 			number: this.number
	// 		}
	// 	});

	// 	// We always fetch the status checks for only the last commit, so there should only be one node present
	// 	const statusCheckRollup = result.data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup;

	// 	if (!statusCheckRollup) {
	// 		return {
	// 			state: 'pending',
	// 			statuses: []
	// 		};
	// 	}

	// 	return {
	// 		state: statusCheckRollup.state.toLowerCase(),
	// 		statuses: statusCheckRollup.contexts.nodes.map(context => {
	// 			if (isCheckRun(context)) {
	// 				return {
	// 					id: context.id,
	// 					url: context.checkSuite.app?.url,
	// 					avatar_url: context.checkSuite.app?.logoUrl,
	// 					state: context.conclusion?.toLowerCase() || 'pending',
	// 					description: context.title,
	// 					context: context.name,
	// 					target_url: context.detailsUrl
	// 				};
	// 			} else {
	// 				return {
	// 					id: context.id,
	// 					url: context.targetUrl,
	// 					avatar_url: context.avatarUrl,
	// 					state: context.state?.toLowerCase(),
	// 					description: context.description,
	// 					context: context.context,
	// 					target_url: context.targetUrl
	// 				};
	// 			}
	// 		})
	// 	};
	// }

	// static async openDiffFromComment(folderManager: FolderRepositoryManager, pullRequestModel: PullRequestModel, comment: IComment): Promise<void> {
	// 	const fileChanges = await pullRequestModel.getFileChangesInfo();
	// 	const mergeBase = pullRequestModel.mergeBase || pullRequestModel.base.sha;
	// 	const contentChanges = await parseDiff(fileChanges, folderManager.repository, mergeBase);
	// 	const change = contentChanges.find(fileChange => fileChange.fileName === comment.path || fileChange.previousFileName === comment.path);
	// 	if (!change) {
	// 		throw new Error(`Can't find matching file`);
	// 	}

	// 	let headUri, baseUri: vscode.Uri;
	// 	if (!pullRequestModel.equals(folderManager.activePullRequest)) {
	// 		const headCommit = pullRequestModel.head!.sha;
	// 		const parentFileName = change.status === GitChangeType.RENAME ? change.previousFileName! : change.fileName;
	// 		headUri = toPRUri(vscode.Uri.file(path.resolve(folderManager.repository.rootUri.fsPath, change.fileName)), pullRequestModel, change.baseCommit, headCommit, change.fileName, false, change.status);
	// 		baseUri = toPRUri(vscode.Uri.file(path.resolve(folderManager.repository.rootUri.fsPath, parentFileName)), pullRequestModel, change.baseCommit, headCommit, change.fileName, true, change.status);
	// 	} else {
	// 		const uri = vscode.Uri.file(path.resolve(folderManager.repository.rootUri.fsPath, change.fileName));

	// 		headUri = change.status === GitChangeType.DELETE
	// 			? toReviewUri(uri, undefined, undefined, '', false, { base: false }, folderManager.repository.rootUri)
	// 			: uri;

	// 		baseUri = toReviewUri(
	// 			uri,
	// 			change.status === GitChangeType.RENAME ? change.previousFileName : change.fileName,
	// 			undefined,
	// 			change.status === GitChangeType.ADD ? '' : mergeBase,
	// 			false,
	// 			{ base: true },
	// 			folderManager.repository.rootUri
	// 		);
	// 	}

	// 	const pathSegments = comment.path!.split('/');
	// 	vscode.commands.executeCommand('vscode.diff', baseUri, headUri, `${pathSegments[pathSegments.length - 1]} (Pull Request)`, {});
	// }

	// /**
	//  * List the changed files in a pull request.
	//  */
	// async getFileChangesInfo(): Promise<IRawFileChange[]> {
	// 	Logger.debug(`Fetch file changes, base, head and merge base of PR #${this.number} - enter`, PullRequestModel.ID);
	// 	const githubRepository = this.githubRepository;
	// 	const { octokit, remote } = await githubRepository.ensure();

	// 	if (!this.base) {
	// 		const info = await octokit.pulls.get({
	// 			owner: remote.owner,
	// 			repo: remote.repositoryName,
	// 			pull_number: this.number
	// 		});
	// 		this.update(convertRESTPullRequestToRawPullRequest(info.data, githubRepository));
	// 	}

	// 	if (this.item.merged) {
	// 		const repsonse = await octokit.pulls.listFiles({
	// 			repo: remote.repositoryName,
	// 			owner: remote.owner,
	// 			pull_number: this.number
	// 		});

	// 		// Use the original base to compare against for merged PRs
	// 		this.mergeBase = this.base.sha;

	// 		return repsonse.data;
	// 	}

	// 	const { data } = await octokit.repos.compareCommits({
	// 		repo: remote.repositoryName,
	// 		owner: remote.owner,
	// 		base: `${this.base.repositoryCloneUrl.owner}:${this.base.ref}`,
	// 		head: `${this.head!.repositoryCloneUrl.owner}:${this.head!.ref}`,

	// 	});

	// 	this.mergeBase = data.merge_base_commit.sha;

	// 	const MAX_FILE_CHANGES_IN_COMPARE_COMMITS = 300;
	// 	let files: Array<IRawFileChange> = [];

	// 	if (data.files.length >= MAX_FILE_CHANGES_IN_COMPARE_COMMITS) {
	// 		// compareCommits will return a maximum of 300 changed files
	// 		// If we have (maybe) more than that, we'll need to fetch them with listFiles API call
	// 		Logger.debug(`More than ${MAX_FILE_CHANGES_IN_COMPARE_COMMITS} files changed, fetching all file changes of PR #${this.number}`, PullRequestModel.ID);
	// 		files = await octokit.paginate(`GET /repos/:owner/:repo/pulls/:pull_number/files`, {
	// 			owner: this.base.repositoryCloneUrl.owner,
	// 			pull_number: this.number,
	// 			repo: remote.repositoryName,
	// 			per_page: 100
	// 		});
	// 	} else {
	// 		// if we're under the limit, just use the result from compareCommits, don't make additional API calls.
	// 		files = data.files;
	// 	}

	// 	Logger.debug(`Fetch file changes and merge base of PR #${this.number} - done, total files ${files.length} `, PullRequestModel.ID);
	// 	return files;
	// }

	// /**
	//  * Get the current mergability of the pull request.
	//  */
	// async getMergability(): Promise<PullRequestMergeability> {
	// 	try {
	// 		Logger.debug(`Fetch pull request mergeability ${this.number} - enter`, PullRequestModel.ID);
	// 		const { query, remote, schema } = await this.githubRepository.ensure();

	// 		const { data } = await query<PullRequestResponse>({
	// 			query: schema.PullRequestMergeability,
	// 			variables: {
	// 				owner: remote.owner,
	// 				name: remote.repositoryName,
	// 				number: this.number
	// 			}
	// 		});
	// 		Logger.debug(`Fetch pull request mergeability ${this.number} - done`, PullRequestModel.ID);
	// 		return parseMergeability(data.repository.pullRequest.mergeable);
	// 	} catch (e) {
	// 		Logger.appendLine(`PullRequestModel> Unable to fetch PR Mergeability: ${e}`);
	// 		return PullRequestMergeability.Unknown;
	// 	}
	// }

	// /**
	//  * Set a draft pull request as ready to be reviewed.
	//  */
	// async setReadyForReview(): Promise<any> {
	// 	try {
	// 		const { mutate, schema } = await this.githubRepository.ensure();

	// 		const { data } = await mutate<MarkPullRequestReadyForReviewResponse>({
	// 			mutation: schema.ReadyForReview,
	// 			variables: {
	// 				input: {
	// 					pullRequestId: this.graphNodeId,
	// 				}
	// 			}
	// 		});

	// 		/* __GDPR__
	// 			"pr.readyForReview.success" : {}
	// 		*/
	// 		this._telemetry.sendTelemetryEvent('pr.readyForReview.success');

	// 		return data!.markPullRequestReadyForReview.pullRequest.isDraft;
	// 	} catch (e) {
	// 		/* __GDPR__
	// 			"pr.readyForReview.failure" : {
	// 				"message" : { "classification": "CallstackOrException", "purpose": "PerformanceAndHealth" }
	// 			}
	// 		*/
	// 		this._telemetry.sendTelemetryErrorEvent('pr.readyForReview.failure', { message: formatError(e) });
	// 		throw e;
	// 	}
	// }
}
