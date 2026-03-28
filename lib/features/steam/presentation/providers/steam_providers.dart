import 'package:flutter/foundation.dart';

import '../../data/models/steam_friend_model.dart';
import '../../data/models/steam_game_model.dart';
import '../../data/models/steam_profile_model.dart';
import '../../data/steam_repository.dart';

class SteamLoadState<T> {
  final bool loading;
  final T? data;
  final String? error;
  const SteamLoadState({required this.loading, this.data, this.error});

  factory SteamLoadState.idle() => const SteamLoadState(loading: false);
  factory SteamLoadState.loading() => const SteamLoadState(loading: true);
  factory SteamLoadState.success(T data) => SteamLoadState(loading: false, data: data);
  factory SteamLoadState.failure(String error) => SteamLoadState(loading: false, error: error);
}

final ValueNotifier<SteamLoadState<SteamProfileModel>> steamProfileProvider =
    ValueNotifier<SteamLoadState<SteamProfileModel>>(SteamLoadState.idle());
final ValueNotifier<SteamLoadState<List<SteamFriendModel>>> steamFriendsProvider =
    ValueNotifier<SteamLoadState<List<SteamFriendModel>>>(SteamLoadState.idle());
final ValueNotifier<SteamLoadState<List<SteamGameModel>>> steamOwnedGamesProvider =
    ValueNotifier<SteamLoadState<List<SteamGameModel>>>(SteamLoadState.idle());
final ValueNotifier<SteamLoadState<List<SteamGameModel>>> steamRecentGamesProvider =
    ValueNotifier<SteamLoadState<List<SteamGameModel>>>(SteamLoadState.idle());
final ValueNotifier<SteamLoadState<List<SteamGameModel>>> steamFavoritesProvider =
    ValueNotifier<SteamLoadState<List<SteamGameModel>>>(SteamLoadState.idle());

class SteamProviderActions {
  SteamProviderActions._();
  static final SteamProviderActions instance = SteamProviderActions._();

  final SteamRepository _repo = SteamRepository();

  Future<void> loadProfile() async {
    steamProfileProvider.value = SteamLoadState.loading();
    try {
      final data = await _repo.getProfile();
      steamProfileProvider.value = SteamLoadState.success(data);
    } catch (e) {
      steamProfileProvider.value = SteamLoadState.failure(e.toString());
    }
  }

  Future<void> loadFriends() async {
    steamFriendsProvider.value = SteamLoadState.loading();
    try {
      final data = await _repo.getFriendsStatus();
      steamFriendsProvider.value = SteamLoadState.success(data);
    } catch (e) {
      steamFriendsProvider.value = SteamLoadState.failure(e.toString());
    }
  }

  Future<void> loadOwnedGames() async {
    steamOwnedGamesProvider.value = SteamLoadState.loading();
    try {
      final data = await _repo.getOwnedGames();
      steamOwnedGamesProvider.value = SteamLoadState.success(data);
    } catch (e) {
      steamOwnedGamesProvider.value = SteamLoadState.failure(e.toString());
    }
  }

  Future<void> loadRecentGames() async {
    steamRecentGamesProvider.value = SteamLoadState.loading();
    try {
      final data = await _repo.getRecentGames();
      steamRecentGamesProvider.value = SteamLoadState.success(data);
    } catch (e) {
      steamRecentGamesProvider.value = SteamLoadState.failure(e.toString());
    }
  }

  Future<void> loadFavorites() async {
    steamFavoritesProvider.value = SteamLoadState.loading();
    try {
      final data = await _repo.getFavorites();
      steamFavoritesProvider.value = SteamLoadState.success(data);
    } catch (e) {
      steamFavoritesProvider.value = SteamLoadState.failure(e.toString());
    }
  }

  Future<void> sync() => _repo.sync();
  Future<void> addFavorite(SteamGameModel game) => _repo.addFavorite(game);
  Future<void> removeFavorite(String appid) => _repo.removeFavorite(appid);
}

