<?php

use App\Http\Controllers\UserController;

Route::get('/u', [UserController::class, 'index']);
Route::get('/l', 'App\Http\Controllers\UserController@legacy');
