export interface CoverSearchData {
	album: string;
	// Track title, used to resolve the album when only the song is known
	title: string;
	artist: string;
	year: string;
}

export interface Artwork {
	bgColor?: string;
	hasP3?: boolean;
	width: number;
	height: number;
	textColor1?: string;
	textColor2?: string;
	textColor3?: string;
	textColor4?: string;
	/** URL template: .../{w}x{h}bb.jpg */
	url: string;
}

export interface VideoAsset {
	video: string;
	previewFrame?: Artwork;
}

export interface AlbumAttributes {
	name: string;
	artistName: string;
	artwork: Artwork;
	// Present only when ?extend=editorialVideo and the album has motion art
	editorialVideo?: {
		motionDetailSquare?: VideoAsset;
		motionDetailTall?: VideoAsset;
		motionSquareVideo1x1?: VideoAsset;
		motionTallVideo3x4?: VideoAsset;
	};
	editorialNotes?: { short?: string; standard?: string };
	genreNames: string[];
	releaseDate: string;
	trackCount: number;
	url: string;
	contentRating?: string;
	copyright?: string;
	recordLabel?: string;
	upc?: string;
	playParams?: { id: string; kind: string };
}

export interface AlbumCover {
	album: string;
	artist: string;
	/** Static artwork URL template, used as the poster frame */
	artwork: string;
	animatedCover: {
		square?: string;
		tall?: string;
		previewFrame?: string;
	};
}

/** What the endpoint returns: the cached cover plus the caller's ISRC. */
export interface AlbumCoverResponse extends AlbumCover {
	isrc: string;
}

export interface AlbumResource {
	id: string;
	type: "albums";
	href: string;
	attributes?: AlbumAttributes;
}

export interface ApiError {
	id: string;
	title: string;
	detail: string;
	status: string;
	code: string;
}

export interface SongAttributes {
	name: string;
	artistName: string;
	albumName?: string;
	isrc?: string;
}

export interface SongResource {
	id: string;
	type: "songs";
	href: string;
	attributes?: SongAttributes;
}

export interface AlbumSearchResults {
	href?: string;
	next?: string;
	data: AlbumResource[];
}

export interface SongSearchResults {
	href?: string;
	next?: string;
	data: SongResource[];
}

export type AppleMusicSearchResponse =
	| {
			results?: { albums?: AlbumSearchResults; songs?: SongSearchResults };
			errors?: never;
	  }
	| { errors: ApiError[]; results?: never };
